export const state = {
  D: [],
};

export function setData(data) {
  state.D = Array.isArray(data) ? data : [];
}

/** @param {Array} D - data array */
export function getByCountry(D) {
  const bc = {};
  (D || []).forEach((d) => {
    const c = d.country || 'Unknown';
    bc[c] = (bc[c] || 0) + 1;
  });
  return bc;
}
