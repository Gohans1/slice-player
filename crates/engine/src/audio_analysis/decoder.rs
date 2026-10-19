//! Single-pass audio analysis: one decode feeds both the Sound Check meter (EBU R128 integrated
//! loudness + true peak, as `ffmpeg -af ebur128=peak=true` measured them in `loudness.ts`) and the
//! 1,000-point waveform (`waveform.ts`). Symphonia (+ libopus) decodes in-process; anything it
//! can't read is transcoded by `ffmpeg` to a WAV pipe and fed through the same code path.

use crate::db::resolve_abs_path;
use ebur128::{EbuR128, Mode};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia_adapter_libopus::OpusDecoder;

pub const WAVEFORM_POINTS: usize = 1000;
/// `waveform.ts` read at most 30 minutes (`-t 1800`); tracks can't be longer anyway
const MAX_WAVEFORM_SECONDS: usize = 1800;
/// `waveform.ts` reduced audio to 200 values per second before picking the peaks
const ENVELOPE_RATE: usize = 200;
/// `waveform.ts` / `loudness.ts` killed ffmpeg after 60s
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(60);
pub const ANALYSIS_CANCELLED: &str = "Audio analysis cancelled";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LoudnessMeasurement {
    /// Integrated loudness, LUFS
    pub loudness: f64,
    /// True peak, dBTP (ffmpeg prints it as dBFS)
    pub true_peak: f64,
}

#[derive(Debug, Clone)]
pub struct AudioAnalysisResult {
    pub peaks: Vec<f64>,
    /// `None` for silence (-inf) or audio nothing could decode
    pub loudness: Option<LoudnessMeasurement>,
}

/// Stops an analysis between two packets (and kills its ffmpeg fallback, if any)
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

static CODECS: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut registry);
    // YouTube's format 251 is Opus in WebM, which Symphonia has no native decoder for
    registry.register_audio_decoder::<OpusDecoder>();
    registry
});

// In-flight waveform jobs, so deleting a track or restoring a backup can stop them (waveform.ts
// kept its ffmpeg processes in activeWaveformProcs / activeWaveformByPath for the same reason)
static JOBS: LazyLock<Mutex<HashMap<u64, (String, CancelFlag)>>> = LazyLock::new(Default::default);
static NEXT_JOB_ID: AtomicU64 = AtomicU64::new(0);

fn job_key(path: &Path) -> String {
    resolve_abs_path(path).to_string_lossy().to_lowercase()
}

struct JobGuard(u64);

impl Drop for JobGuard {
    fn drop(&mut self) {
        JOBS.lock().unwrap().remove(&self.0);
    }
}

fn register_job(path: &Path, cancel: &CancelFlag) -> JobGuard {
    let id = NEXT_JOB_ID.fetch_add(1, Ordering::SeqCst);
    JOBS.lock().unwrap().insert(id, (job_key(path), cancel.clone()));
    JobGuard(id)
}

pub fn cancel_waveform_for_file(file_path: &str) {
    let key = job_key(Path::new(file_path));
    for (path, cancel) in JOBS.lock().unwrap().values() {
        if *path == key {
            cancel.cancel();
        }
    }
}

pub fn abort_waveform_processes() {
    for (_, cancel) in JOBS.lock().unwrap().drain().map(|(_, job)| job) {
        cancel.cancel();
    }
}

pub fn is_waveform_busy() -> bool {
    !JOBS.lock().unwrap().is_empty()
}

/// Peaks + loudness of a file in one decode. Errs when the file is missing or the job was
/// cancelled through [`cancel_waveform_for_file`] / [`abort_waveform_processes`].
pub async fn analyze_audio_file(
    file_path: impl AsRef<Path>,
    target_points: usize,
) -> Result<AudioAnalysisResult, String> {
    analyze_audio_file_with(file_path, target_points, CancelFlag::new()).await
}

/// Same as [`analyze_audio_file`], cancelled through the caller's flag or [`cancel_waveform_for_file`]
pub async fn analyze_audio_file_with(
    file_path: impl AsRef<Path>,
    target_points: usize,
    cancel: CancelFlag,
) -> Result<AudioAnalysisResult, String> {
    let path = file_path.as_ref().to_path_buf();
    if !path.exists() {
        return Err(format!("Audio file not found: {}", path.display()));
    }
    let _job = register_job(&path, &cancel);
    tokio::task::spawn_blocking(move || analyze_blocking(&path, target_points, &cancel))
        .await
        .map_err(|e| e.to_string())?
}

pub async fn generate_peaks(
    file_path: impl AsRef<Path>,
    target_points: usize,
) -> Result<Vec<f64>, String> {
    Ok(analyze_audio_file(file_path, target_points).await?.peaks)
}

pub async fn measure_loudness(file_path: impl AsRef<Path>) -> Option<LoudnessMeasurement> {
    analyze_audio_file(file_path, WAVEFORM_POINTS)
        .await
        .ok()?
        .loudness
}

fn analyze_blocking(
    path: &Path,
    target_points: usize,
    cancel: &CancelFlag,
) -> Result<AudioAnalysisResult, String> {
    let mut acc = Accumulator::default();
    match decode_natively(path, &mut acc, cancel) {
        Ok(()) if acc.frames > 0 => return Ok(acc.finish(target_points)),
        Err(Failure::Cancelled) => return Err(ANALYSIS_CANCELLED.into()),
        Ok(()) => {}
        Err(Failure::Undecodable(reason)) => {
            eprintln!("[Waveform] native decode failed for {}, trying ffmpeg: {reason}", path.display());
        }
    }

    let mut acc = Accumulator::default();
    let fallback = decode_with_ffmpeg(path, &mut acc, cancel);
    if cancel.is_cancelled() {
        return Err(ANALYSIS_CANCELLED.into());
    }
    if acc.frames > 0 {
        return Ok(acc.finish(target_points));
    }
    if let Err(Failure::Undecodable(reason)) = fallback {
        eprintln!("[Waveform] ffmpeg could not decode {}, using flat peaks: {reason}", path.display());
    }
    Ok(AudioAnalysisResult {
        peaks: vec![0.1; target_points],
        loudness: None,
    })
}

enum Failure {
    Cancelled,
    Undecodable(String),
}

impl From<SymphoniaError> for Failure {
    fn from(err: SymphoniaError) -> Self {
        Failure::Undecodable(err.to_string())
    }
}

fn decode_natively(path: &Path, acc: &mut Accumulator, cancel: &CancelFlag) -> Result<(), Failure> {
    let file = std::fs::File::open(path).map_err(|e| Failure::Undecodable(e.to_string()))?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    decode_stream(MediaSourceStream::new(Box::new(file), Default::default()), &hint, acc, cancel)
}

/// Lets ffmpeg decode what Symphonia can't, as a 32-bit float WAV stream into the same analysis
fn decode_with_ffmpeg(path: &Path, acc: &mut Accumulator, cancel: &CancelFlag) -> Result<(), Failure> {
    let mut child = Command::new("ffmpeg")
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "wav", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| Failure::Undecodable(format!("ffmpeg: {e}")))?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let child = Arc::new(Mutex::new(child));
    let done = Arc::new(AtomicBool::new(false));

    // ponytail: polls every 100ms; a cancel or the 60s limit kills ffmpeg so a blocked read returns
    let watchdog = {
        let (child, done, cancel) = (child.clone(), done.clone(), cancel.clone());
        std::thread::spawn(move || {
            let started = Instant::now();
            while !done.load(Ordering::SeqCst) {
                if cancel.is_cancelled() || started.elapsed() > FFMPEG_TIMEOUT {
                    let _ = child.lock().unwrap().kill();
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
    };

    let mut hint = Hint::new();
    hint.with_extension("wav");
    let source = MediaSourceStream::new(Box::new(ReadOnlySource::new(stdout)), Default::default());
    let result = decode_stream(source, &hint, acc, cancel);

    done.store(true, Ordering::SeqCst);
    let _ = watchdog.join();
    let mut child = child.lock().unwrap();
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn decode_stream(
    source: MediaSourceStream<'_>,
    hint: &Hint,
    acc: &mut Accumulator,
    cancel: &CancelFlag,
) -> Result<(), Failure> {
    let mut format =
        symphonia::default::get_probe().probe(hint, source, FormatOptions::default(), MetadataOptions::default())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| Failure::Undecodable("no audio track".into()))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| Failure::Undecodable("no audio codec parameters".into()))?
        .clone();
    let mut decoder = CODECS.make_audio_decoder(&params, &AudioDecoderOptions::default())?;
    let mut samples: Vec<f32> = Vec::new();

    loop {
        if cancel.is_cancelled() {
            return Err(Failure::Cancelled);
        }
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) | Err(SymphoniaError::ResetRequired) => return Ok(()),
            // A stream cut short (or an ffmpeg pipe that closed) ends the audio, it isn't a failure
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(audio) => {
                let spec = audio.spec();
                let (channels, rate) = (spec.channels().count(), spec.rate());
                audio.copy_to_vec_interleaved(&mut samples);
                acc.push(&samples, channels, rate)?;
            }
            // A damaged packet is skipped, as ffmpeg does
            Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
            Err(e) => return Err(e.into()),
        }
    }
}

/// Everything one decode pass produces, fed frame by frame
#[derive(Default)]
struct Accumulator {
    meter: Option<EbuR128>,
    channels: usize,
    frames: u64,
    // Waveform: the loudest mono sample of every 1/200 s, like waveform.ts' 200 Hz stream
    window_frames: usize,
    window_filled: usize,
    window_peak: f32,
    envelope: Vec<f32>,
    envelope_cap: usize,
}

impl Accumulator {
    fn push(&mut self, interleaved: &[f32], channels: usize, rate: u32) -> Result<(), Failure> {
        if channels == 0 || rate == 0 {
            return Ok(());
        }
        if self.meter.is_none() {
            // Mono keeps the meter's default single-channel weighting (no dual mono): that is what
            // ffmpeg's ebur128 filter did for every loudness value already stored in the library
            let meter = EbuR128::new(channels as u32, rate, Mode::I | Mode::TRUE_PEAK)
                .map_err(|e| Failure::Undecodable(format!("ebur128: {e}")))?;
            self.meter = Some(meter);
            self.channels = channels;
            self.window_frames = (rate as usize / ENVELOPE_RATE).max(1);
            self.envelope_cap = MAX_WAVEFORM_SECONDS * ENVELOPE_RATE;
        }
        if channels != self.channels {
            return Err(Failure::Undecodable("channel count changed mid-stream".into()));
        }
        let meter = self.meter.as_mut().expect("meter set above");
        meter
            .add_frames_f32(interleaved)
            .map_err(|e| Failure::Undecodable(format!("ebur128: {e}")))?;

        for frame in interleaved.chunks_exact(channels) {
            self.frames += 1;
            if self.envelope.len() >= self.envelope_cap {
                continue;
            }
            let mono = frame.iter().sum::<f32>() / channels as f32;
            self.window_peak = self.window_peak.max(mono.abs());
            self.window_filled += 1;
            if self.window_filled == self.window_frames {
                self.envelope.push(self.window_peak.min(1.0));
                self.window_filled = 0;
                self.window_peak = 0.0;
            }
        }
        Ok(())
    }

    fn finish(mut self, target_points: usize) -> AudioAnalysisResult {
        if self.window_filled > 0 && self.envelope.len() < self.envelope_cap {
            self.envelope.push(self.window_peak.min(1.0));
        }
        let loudness = self.meter.as_ref().and_then(|meter| {
            let loudness = meter.loudness_global().ok()?;
            let peak = (0..self.channels as u32)
                .filter_map(|ch| meter.true_peak(ch).ok())
                .fold(0.0_f64, f64::max);
            let true_peak = 20.0 * peak.log10();
            // Silence has no loudness to match and a peak of -inf
            (loudness.is_finite() && true_peak.is_finite()).then_some(LoudnessMeasurement { loudness, true_peak })
        });
        AudioAnalysisResult {
            peaks: bin_peaks(&self.envelope, target_points),
            loudness,
        }
    }
}

fn round3(value: f32) -> f64 {
    (f64::from(value) * 1000.0).round() / 1000.0
}

/// waveform.ts' binning of the 200 Hz stream into `target` points, kept as is
fn bin_peaks(samples: &[f32], target: usize) -> Vec<f64> {
    let block = samples.len() / target.max(1);
    if block <= 1 {
        return (0..target)
            .map(|i| match samples.get(i * samples.len() / target.max(1)) {
                Some(&s) => round3(s),
                None if samples.is_empty() => 0.05,
                None => 0.0,
            })
            .collect();
    }
    (0..target)
        .map(|i| {
            let start = i * block;
            let end = if i == target - 1 { samples.len() } else { (start + block).min(samples.len()) };
            round3(samples[start..end].iter().copied().fold(0.0, f32::max))
        })
        .collect()
}
