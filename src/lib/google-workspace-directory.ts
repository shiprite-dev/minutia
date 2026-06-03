const GOOGLE_PEOPLE_API = "https://people.googleapis.com/v1";
const DIRECTORY_READ_MASK = "names,emailAddresses,photos,organizations";
const DIRECTORY_SOURCES = [
  "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
  "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT",
];

export class GoogleDirectoryPermissionError extends Error {
  constructor() {
    super("Google Workspace directory access was not granted");
    this.name = "GoogleDirectoryPermissionError";
  }
}

type GoogleDirectoryPerson = {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  photos?: { url?: string }[];
  organizations?: { name?: string }[];
};

type GoogleDirectorySearchResponse = {
  people?: GoogleDirectoryPerson[];
};

export type WorkspaceDirectoryPerson = {
  resourceName: string;
  name: string;
  email: string;
  photoUrl?: string;
  organization?: string;
};

export function normalizeWorkspaceDirectoryPeople(
  people: GoogleDirectoryPerson[]
): WorkspaceDirectoryPerson[] {
  return people.flatMap((person) => {
    const email = person.emailAddresses?.find((entry) => entry.value)?.value;
    if (!email) return [];

    return [
      {
        resourceName: person.resourceName ?? email,
        name: person.names?.find((entry) => entry.displayName)?.displayName ?? email,
        email,
        photoUrl: person.photos?.find((entry) => entry.url)?.url,
        organization: person.organizations?.find((entry) => entry.name)?.name,
      },
    ];
  });
}

export async function searchWorkspaceDirectory(
  accessToken: string,
  query: string,
  pageSize = 8
): Promise<WorkspaceDirectoryPerson[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return [];

  const params = new URLSearchParams({
    query: trimmedQuery,
    readMask: DIRECTORY_READ_MASK,
    pageSize: String(Math.min(Math.max(pageSize, 1), 25)),
  });
  for (const source of DIRECTORY_SOURCES) {
    params.append("sources", source);
  }

  const res = await fetch(`${GOOGLE_PEOPLE_API}/people:searchDirectoryPeople?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new GoogleDirectoryPermissionError();
  }
  if (!res.ok) {
    throw new Error(`Workspace directory search failed: ${res.status}`);
  }

  const data = (await res.json()) as GoogleDirectorySearchResponse;
  return normalizeWorkspaceDirectoryPeople(data.people ?? []);
}
