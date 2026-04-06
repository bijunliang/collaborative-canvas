import questionConfig from '@/content/question-of-day.json';

type QuestionEntry = {
  date: string;
  question: string;
};

function toIsoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getQuestionOfDay(now: Date = new Date()): string {
  const schedule = (questionConfig.schedule ?? []) as QuestionEntry[];
  const today = toIsoDateUTC(now);

  const exact = schedule.find((entry) => entry.date === today);
  if (exact?.question?.trim()) return exact.question.trim();

  const past = schedule
    .filter((entry) => entry.date <= today && entry.question?.trim())
    .sort((a, b) => b.date.localeCompare(a.date));

  if (past.length > 0) return past[0].question.trim();

  return questionConfig.defaultQuestion?.trim() || 'Prompt here';
}

