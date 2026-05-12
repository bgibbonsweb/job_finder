function normalizeBookmarksData(data) {
  const bookmarked = Array.isArray(data?.bookmarked)
    ? [...new Set(data.bookmarked.map((v) => String(v || '').trim()).filter(Boolean))]
    : [];
  const hidden = Array.isArray(data?.hidden)
    ? [...new Set(data.hidden.map((v) => String(v || '').trim()).filter(Boolean))]
    : [];
  const hiddenCompanies = Array.isArray(data?.hiddenCompanies)
    ? [...new Set(data.hiddenCompanies.map((v) => String(v || '').trim()).filter(Boolean))]
    : [];

  return { bookmarked, hidden, hiddenCompanies };
}

module.exports = {
  normalizeBookmarksData,
};
