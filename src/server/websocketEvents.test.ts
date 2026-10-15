import { expect, it } from "bun:test";
import { serverEvents } from "./events";
import { forwardServerEvents } from "./websocketEvents";

it("forwards single and batch deletion payloads to connected clients", () => {
  const messages: object[] = [];
  const disconnect = forwardServerEvents((message) => { messages.push(message); });
  try {
    serverEvents.emit("track_deleted", { trackId: "track-one" });
    serverEvents.emit("tracks_deleted", { trackIds: ["track-two", "track-three"] });
    serverEvents.emit("segments_deleted", { segmentIds: ["slice-one"], trackIds: ["track-four"] });
    expect(messages).toEqual([
      { type: "track_deleted", trackId: "track-one" },
      { type: "tracks_deleted", trackIds: ["track-two", "track-three"] },
      { type: "segments_deleted", segmentIds: ["slice-one"], trackIds: ["track-four"] },
    ]);
  } finally {
    disconnect();
  }
});
