export const state = {
  D: [],
};

export function setData(data) {
  state.D = Array.isArray(data) ? data : [];
}
