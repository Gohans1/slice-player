import * as React from "react";
import { useTranslation } from "react-i18next";

// Writes a count the way the reader's language writes numbers: 1,236 in English, 1.236 in Vietnamese. Translations do
// the same with {{count, number}}; this is for counts shown on their own, like badges. It follows i18n.language, as
// i18next's formatter does, so a regional language such as en-IN groups digits the same way in both.
export function useFormatNumber(): (value: number) => string {
  const { i18n } = useTranslation();
  const language = i18n.language;
  return React.useMemo(() => {
    const formatter = new Intl.NumberFormat(language);
    return (value: number) => formatter.format(value);
  }, [language]);
}
