import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUESTION_DIR = path.resolve(__dirname, '../game_questions');

const MODE_FILES = {
  classic: 'classic.json',
  multiselect: 'multiselect.json',
  duel: 'duel.json',
  oddoneout: 'oddoneout.json',
  cardflip: 'cardflip.json',
  rapidfire: 'rapidfire.json'
};

const COUNT_REQUIRED_MODES = new Set([
  'multiselect',
  'duel',
  'oddoneout',
  'cardflip'
]);

const QUESTION_REQUIRED_MODES = new Set([
  'multiselect',
  'duel',
  'oddoneout'
]);

let templateCachePromise = null;

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function validateTemplate(mode, template, index) {
  if (!template || typeof template !== 'object') {
    throw new Error(`[QuestionConfig] ${mode}[${index}] must be an object`);
  }

  const imageCount = toInt(template.imageCount);
  const aiCount = toInt(template.aiCount);
  const humanCount = toInt(template.humanCount);

  if (!Number.isInteger(imageCount) || imageCount <= 0) {
    throw new Error(`[QuestionConfig] ${mode}[${index}] has invalid imageCount`);
  }

  if (COUNT_REQUIRED_MODES.has(mode)) {
    if (!Number.isInteger(aiCount) || aiCount < 0) {
      throw new Error(`[QuestionConfig] ${mode}[${index}] has invalid aiCount`);
    }

    if (!Number.isInteger(humanCount) || humanCount < 0) {
      throw new Error(`[QuestionConfig] ${mode}[${index}] has invalid humanCount`);
    }

    if (aiCount + humanCount !== imageCount) {
      throw new Error(`[QuestionConfig] ${mode}[${index}] aiCount + humanCount must equal imageCount`);
    }
  }

  if (QUESTION_REQUIRED_MODES.has(mode)) {
    const askingFor = String(template.askingFor || '').trim().toLowerCase();
    if (askingFor !== 'ai' && askingFor !== 'human') {
      throw new Error(`[QuestionConfig] ${mode}[${index}] askingFor must be 'ai' or 'human'`);
    }
  }

  if (mode === 'duel' && (aiCount !== 1 || humanCount !== 1 || imageCount !== 2)) {
    throw new Error(`[QuestionConfig] ${mode}[${index}] must be exactly 1 AI and 1 Human`);
  }

  if (mode === 'oddoneout') {
    const validOddSetup = imageCount === 5 && (
      (aiCount === 4 && humanCount === 1 && template.askingFor === 'human') ||
      (aiCount === 1 && humanCount === 4 && template.askingFor === 'ai')
    );

    if (!validOddSetup) {
      throw new Error(`[QuestionConfig] ${mode}[${index}] must be 4/1 split with opposite askingFor`);
    }
  }
}

async function readModeTemplates(mode, filename) {
  const fullPath = path.resolve(QUESTION_DIR, filename);
  const raw = await readFile(fullPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`[QuestionConfig] ${mode} file must contain a non-empty array`);
  }

  parsed.forEach((template, idx) => validateTemplate(mode, template, idx));

  return parsed.map((template, idx) => ({
    ...template,
    templateKey: String(template.templateKey || `${mode}-${idx + 1}`),
    imageCount: toInt(template.imageCount),
    aiCount: Number.isInteger(toInt(template.aiCount)) ? toInt(template.aiCount) : null,
    humanCount: Number.isInteger(toInt(template.humanCount)) ? toInt(template.humanCount) : null,
    askingFor: template.askingFor ? String(template.askingFor).toLowerCase() : null,
    variant: template.variant ? String(template.variant).toLowerCase() : null,
    timeLimitSec: Number.isInteger(toInt(template.timeLimitSec)) ? toInt(template.timeLimitSec) : null,
    lives: Number.isInteger(toInt(template.lives)) ? toInt(template.lives) : null
  }));
}

async function loadAllTemplates() {
  const entries = await Promise.all(
    Object.entries(MODE_FILES).map(async ([mode, filename]) => {
      const templates = await readModeTemplates(mode, filename);
      return [mode, templates];
    })
  );

  return Object.fromEntries(entries);
}

export function supportedGameModes() {
  return Object.keys(MODE_FILES);
}

export async function getTemplatesForMode(mode) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!MODE_FILES[normalizedMode]) {
    throw new Error(`[QuestionConfig] Unsupported mode: ${normalizedMode}`);
  }

  if (!templateCachePromise) {
    templateCachePromise = loadAllTemplates();
  }

  const cache = await templateCachePromise;
  return cache[normalizedMode] || [];
}

export async function getRandomTemplate(mode, variant = null) {
  const templates = await getTemplatesForMode(mode);
  const normalizedVariant = variant ? String(variant).trim().toLowerCase() : null;

  const applicable = normalizedVariant
    ? templates.filter((template) => !template.variant || template.variant === normalizedVariant)
    : templates;

  if (!applicable.length) {
    const suffix = normalizedVariant ? ` (variant: ${normalizedVariant})` : '';
    throw new Error(`[QuestionConfig] No templates for mode ${mode}${suffix}`);
  }

  const idx = Math.floor(Math.random() * applicable.length);
  return applicable[idx];
}
