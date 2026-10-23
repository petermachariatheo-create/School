import { useState } from "react";
import { ApiClient, ApiError } from "../api/client.ts";
import type { EntityMeta } from "../app/fields.ts";
import { Button } from "../ui/Button.tsx";

/**
 * CSV import.
 *
 * The import runs in two steps on purpose: the server first validates the
 * file and reports what it would do, and only an explicit confirmation
 * applies the change. A mis-picked file therefore cannot silently rewrite
 * a school's data.
 */

export interface ImportDialogProps {
  readonly entity: EntityMeta;
  readonly onClose: () => void;
  readonly onImported: () => void;
}

interface PreviewRow {
  readonly row: number;
  readonly status: "valid" | "invalid" | "duplicate";
  readonly problems: string[];
  readonly duplicateOf: string | null;
}

interface Preview {
  readonly entityType: string;
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly duplicateRows: number;
  readonly rows: PreviewRow[];
  readonly problems: { row: number; column: string; message: string }[];
}

interface PreviewResponse {
  readonly applied: boolean;
  readonly preview: Preview;
}

export function ImportDialog({ entity, onClose, onImported }: ImportDialogProps): React.ReactNode {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = new ApiClient({ baseUrl: import.meta.env["VITE_API_BASE_URL"] ?? "" });

  const runPreview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.postRaw<PreviewResponse>(
        `/api/v1/${entity.restPath}/import`,
        csv,
        "text/csv",
      );
      setPreview(response);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? (cause.problem.detail ?? cause.problem.title) : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.postRaw<unknown>(`/api/v1/${entity.restPath}/import?apply=true`, csv, "text/csv");
      onImported();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? (cause.problem.detail ?? cause.problem.title) : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={`Import ${entity.label}`}>
      <div className="drawer__panel">
        <header className="drawer__header">
          <h2>Import {entity.label.toLowerCase()}s from CSV</h2>
          <Button variant="quiet" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </header>

        <div className="form">
          <div className="field">
            <label htmlFor="import-csv">CSV file</label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file === undefined) {
                  return;
                }
                void file.text().then((text) => {
                  setCsv(text);
                  setPreview(null);
                });
              }}
            />
            <textarea
              id="import-csv"
              rows={10}
              className="mono"
              spellCheck={false}
              value={csv}
              placeholder="admissionNumber,firstName,lastName"
              onChange={(event) => {
                setCsv(event.target.value);
                setPreview(null);
              }}
            />
          </div>

          {error !== null && (
            <p className="problems" role="alert">
              {error}
            </p>
          )}

          {preview !== null && (
            <div className="preview">
              <h3>Preview</h3>
              <p>
                {preview.preview.validRows} ready to import · {preview.preview.duplicateRows}{" "}
                already exist · {preview.preview.invalidRows} invalid · {preview.preview.totalRows}{" "}
                rows read
              </p>
              {preview.preview.rows.length > 0 && (
                <ul className="preview__rows">
                  {preview.preview.rows.slice(0, 50).map((row) => (
                    <li key={row.row} className={`preview__row preview__row--${row.status}`}>
                      <span className="preview__line">row {row.row}</span>
                      <span className="preview__status">{row.status}</span>
                      {row.problems.length > 0 && <span>{row.problems.join("; ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <footer className="drawer__actions">
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void runPreview()} disabled={busy || csv.trim() === ""}>
              Check
            </Button>
            <Button
              variant="primary"
              onClick={() => void apply()}
              disabled={busy || preview === null || preview.preview.validRows === 0}
            >
              Apply
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}
