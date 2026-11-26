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

// agy identifies choices by their schema constants and uses a sibling field
// for a write-in. Keep those wire values separate from the browser labels.
export function agyForm(schema) {
  if (schema?.type !== 'object' || !schema.properties || Array.isArray(schema.properties)) return;
  const fields = new Map();
  const props = schema.properties;
  for (const [id, prop] of Object.entries(props)) {
    if (id.endsWith('_other') && Object.hasOwn(props, id.slice(0, -6))) continue;
    if (!prop || !['string', 'array'].includes(prop.type)) return;
    const multiple = prop.type === 'array';
    const choices = multiple ? prop.items?.anyOf : prop.oneOf;
    if ((multiple && !Array.isArray(choices)) || (choices && !Array.isArray(choices))) return;
    const options = new Map();
    for (const option of choices ?? []) {
      if (typeof option?.const !== 'string' || typeof option.title !== 'string' || options.has(option.title)) return;
      options.set(option.title, option.const);
    }
    if (options.size > 12) return;
    fields.set(id, { id, question: prop.title || prop.description || id, options, multiple,
      other: props[id + '_other']?.type === 'string' });
  }
  const items = userQuestions([...fields.values()].map(field => ({
    ...field, options: [...field.options.keys()].map(label => ({ label })), isOther: field.other,
  })));
  if (!items || items.some(item => item.options.length !== fields.get(item.id).options.size)) return;
  for (const item of items) item.multiple = fields.get(item.id).multiple;
  return { items, content(answers) {
    const result = Object.create(null);
    for (const [id, field] of fields) {
      const values = answers[id];
      if (!field.options.size && !field.multiple) { result[id] = values[0]; continue; }
      const selected = values.filter(value => field.options.has(value)).map(value => field.options.get(value));
      if (selected.length) result[id] = field.multiple ? selected : selected[0];
      const custom = values.find(value => !field.options.has(value));
      if (custom && field.other) result[id + '_other'] = custom;
    }
    return result;
  } };
}
