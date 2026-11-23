import type { Pricing, Session, SessionSummary } from "../shared/types";

// Lit une réponse JSON en transformant tout échec (réseau, HTTP, JSON invalide)
// en Error au message lisible, pour l'afficher tel quel dans l'interface.
async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Serveur injoignable (${url}). Le backend est-il lancé sur le port 3001 ?`);
  }
  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status} ${response.statusText} sur ${url}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    // Vite renvoie du HTML (index.html) quand le proxy n'a pas de backend derrière.
    throw new Error(`Réponse invalide (JSON attendu) sur ${url}`);
  }
}

export function fetchSessions(): Promise<SessionSummary[]> {
  return getJson<SessionSummary[]>("/api/sessions");
}

export function fetchSession(id: string): Promise<Session> {
  return getJson<Session>(`/api/sessions/${encodeURIComponent(id)}`);
}

export function fetchPricing(): Promise<Pricing> {
  return getJson<Pricing>("/api/pricing");
}
