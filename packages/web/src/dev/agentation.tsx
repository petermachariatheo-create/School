import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";

/**
 * The feedback toolbar.
 *
 * A person clicks an element of the running application, writes what is
 * wrong with it, and gets a note that names the element precisely enough
 * for an agent to find the code: the path to the element, its classes, its
 * text, and — in a development build — the source file it came from.
 *
 * The toolbar is a development tool, and it is mounted in a root of its own
 * rather than inside the application's tree, so that nothing the
 * application renders has to know that it exists. It is not part of the
 * application the school uses: the build drops it unless it is asked for.
 */
export function mountAgentation(): void {
  const host = document.createElement("div");
  host.setAttribute("data-agentation-host", "true");
  document.body.appendChild(host);

  createRoot(host).render(
    <Agentation appName="School Manager" endpoint={import.meta.env.VITE_AGENTATION_ENDPOINT} />,
  );
}
