import { HttpError } from './common.mjs';

export function userQuestions(items, claude = false) {
  if (!Array.isArray(items) || !items.length || items.length > 8) return;
  const questions = items.map((item, index) => {
    const options = Array.isArray(item?.options) ? item.options.slice(0, 12).filter(option =>
      typeof option?.label === 'string' && option.label.trim() && option.label.length <= 300).map(option => ({
      label: option.label, description: typeof option.description === 'string' ? option.description.slice(0, 800) : '',
    })) : [];
    if (typeof item?.question !== 'string' || !item.question.trim() || item.question.length > 3000) return;
    return { id: claude ? String(index) : item.id, question: item.question, header: typeof item.header === 'string' ? item.header.slice(0, 80) : '',
      options, multiple: claude && item.multiSelect === true, other: claude || item.isOther === true || item.isSecret === true || !options.length,
      secret: item.isSecret === true };
  });
  if (questions.some(item => typeof item?.id !== 'string' || !item.id || item.id.length > 180) ||
      new Set(questions.map(item => item.id)).size !== questions.length) return;
  return questions;
}

export function userAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Answer every question.');
  return Object.fromEntries(questions.map(question => {
    const values = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
    if (!Array.isArray(values) || !values.length || values.length > (question.multiple ? question.options.length + 1 : 1) ||
        values.some(value => typeof value !== 'string' || !value.trim() || value.length > 2000 ||
          (!question.other && !question.options.some(option => option.label === value)))) {
      throw new HttpError(400, 'Choose or enter a valid answer for every question.');
    }
    return [question.id, [...new Set(values)]];
  }));
}
