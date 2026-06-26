import api from "@/lib/api";

/** CRUD client for one reference resource (train-names, coach-types, …). */
function makeReferenceApi(path) {
  return {
    list: async (search = "") => {
      const { data } = await api.get(`/reference/${path}`, { params: { search } });
      return data.items;
    },
    create: async (name) => {
      const { data } = await api.post(`/reference/${path}`, { name });
      return data.item;
    },
    update: async (id, name) => {
      const { data } = await api.put(`/reference/${path}/${id}`, { name });
      return data.item;
    },
    remove: (id) => api.delete(`/reference/${path}/${id}`),
  };
}

export const trainNamesApi = makeReferenceApi("train-names");
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
