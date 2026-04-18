export const state = { apps: [], meta: null, editingId: null, attachmentDrafts: {} };
export const byId = (id) => state.apps.find((app) => app.id === id);
