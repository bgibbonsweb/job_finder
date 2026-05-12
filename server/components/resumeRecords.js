function normalizeResumeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildProfileLabelFromText(text, fallback = 'Uploaded Resume') {
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine && firstLine.length <= 64) return firstLine;
  return fallback;
}

function normalizeResumeRecord(record, fallbackIndex = 0) {
  const text = normalizeResumeText(record?.text || record?.profileText || '');
  const id = String(record?.id || `resume-${fallbackIndex + 1}`).trim() || `resume-${fallbackIndex + 1}`;
  const name = buildProfileLabelFromText(text, String(record?.name || `Resume ${fallbackIndex + 1}`));
  return {
    id,
    name,
    text,
    sourceName: String(record?.sourceName || record?.fileName || 'Upload').trim() || 'Upload',
    createdAt: record?.createdAt || new Date().toISOString(),
    updatedAt: record?.updatedAt || record?.createdAt || new Date().toISOString(),
  };
}

module.exports = {
  normalizeResumeText,
  buildProfileLabelFromText,
  normalizeResumeRecord,
};
