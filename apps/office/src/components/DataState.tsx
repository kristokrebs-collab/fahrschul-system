export function DataState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <p className="dim">Lädt…</p>;
  if (error)
    return (
      <p role="alert" className="form-error">
        Fehler: {error}
      </p>
    );
  return null;
}
