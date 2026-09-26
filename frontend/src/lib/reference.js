import api from "@/lib/api";

/**
 * CRUD client for one reference resource (train-names, coach-types, …).
 *
 * Create and update take either a bare name or a whole payload. Most of these
 * tables are a name and nothing else, and the generic manager passes a string;
 * coach classes also carry a standing capacity, and pass an object. Accepting
 * both keeps one client rather than two.
 */
function makeReferenceApi(path) {
  const payloadOf = (input) => (typeof input === "string" ? { name: input } : input);

  return {
    list: async (search = "") => {
      const { data } = await api.get(`/reference/${path}`, { params: { search } });
      return data.items;
    },
    create: async (input) => {
      const { data } = await api.post(`/reference/${path}`, payloadOf(input));
      return data.item;
    },
    update: async (id, input) => {
      const { data } = await api.put(`/reference/${path}/${id}`, payloadOf(input));
      return data.item;
    },
    remove: (id) => api.delete(`/reference/${path}/${id}`),
  };
}

/**
 * Read-only. Trains are managed under Network → Trains, which also owns their
 * routes, composition and schedules; this list exists so the seat-plan editor
 * can offer a dropdown to planners, who hold no `network:view`.
 */
export const trainNamesApi = {
  list: makeReferenceApi("train-names").list,
};

export const coachTypesApi = makeReferenceApi("coach-types");
export const coachClassesApi = makeReferenceApi("coach-classes");

/** Fetch all three lookup lists at once (for plan editor dropdowns). */
export async function fetchAllReferences() {
  const [trainNames, coachTypes, coachClasses] = await Promise.all([
    trainNamesApi.list(),
    coachTypesApi.list(),
    coachClassesApi.list(),
  ]);
  return { trainNames, coachTypes, coachClasses };
}
