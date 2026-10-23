import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { connectUrls, type ServerInfo } from "../app/server.ts";
import { Button } from "../ui/Button.tsx";

/**
 * The "add another device" panel.
 *
 * Somebody standing in front of the school server with a phone in their hand
 * needs two things: the address to type, and the confidence that typing it
 * will work. The panel gives both — the address in a form that can be read
 * aloud or copied, and a code to scan with the phone's camera.
 */

export interface ConnectPanelProps {
  readonly info: ServerInfo | null;
  /** Called when the panel is closed. */
  readonly onClose: () => void;
}

export function ConnectPanel({ info, onClose }: ConnectPanelProps): React.ReactNode {
  const [qr, setQr] = useState<string | null>(null);

  const urls = info === null ? null : connectUrls(info);
  // The secure address is the one to use: a browser only lets the
  // application work offline, and only installs it as an app, when it is
  // served from a secure origin.
  const recommended = urls?.securePrimary ?? urls?.primary ?? "";
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    if (recommended === "") {
      return;
    }
    let cancelled = false;
    void QRCode.toString(recommended, {
      type: "svg",
      margin: 1,
      width: 220,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancelled) {
          setQr(svg);
        }
      })
      .catch(() => {
        // A missing code is not worth failing over; the address is still shown.
      });
    return () => {
      cancelled = true;
    };
  }, [recommended]);

  return (
    <div className="drawer">
      <section className="drawer__panel" role="dialog" aria-label="Add another device">
        <header className="drawer__header">
          <h2>Add another device</h2>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="form">
          {info === null ? (
            <p className="empty">
              The server has not been reached yet. Connect to the school network and this panel will
              show the address to use.
            </p>
          ) : (
            <>
              <p className="field__hint">
                The device must be on the same network as this computer. Open the address below in
                the device&rsquo;s browser, then choose &ldquo;Add to Home screen&rdquo; to install
                it as an app.
              </p>

              {urls !== null && urls.securePrimary === null && (
                <p className="banner banner--warning">
                  This server has no certificate yet, so the application will not work offline on
                  another device. Ask whoever installed the server to add one.
                </p>
              )}

              <div className="connect">
                <div className="connect__qr" aria-hidden="true">
                  {qr === null ? (
                    <div className="connect__qr-placeholder" />
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: qr }} />
                  )}
                </div>

                <div className="connect__details">
                  <div className="field">
                    <div className="field__head">
                      <label htmlFor="connect-address">Address to open</label>
                    </div>
                    <input
                      id="connect-address"
                      className="mono"
                      type="text"
                      readOnly
                      value={recommended}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </div>

                  {urls !== null && urls.all.length > 1 && (
                    <ul className="connect__alternatives">
                      {urls.all.slice(1).map((url) => (
                        <li key={url}>
                          <span className="mono">{url}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {origin !== "" && origin !== recommended && (
                    <p className="field__hint">
                      This computer is using <span className="mono">{origin}</span>.
                    </p>
                  )}
                </div>
              </div>

              <ol className="connect__steps">
                <li>Connect the device to the school&rsquo;s Wi-Fi.</li>
                <li>Scan the code, or type the address into the device&rsquo;s browser.</li>
                <li>
                  In the browser, choose &ldquo;Add to Home screen&rdquo;. The school then opens
                  like an ordinary app, and keeps working when the network does not.
                </li>
              </ol>

              {urls !== null && urls.securePrimary !== null && (
                <div className="connect__certificate">
                  <h3>Before the device can work offline</h3>
                  <p className="field__hint">
                    A browser only lets an application work without a network when it is served from
                    a secure address, so the device has to trust the school&rsquo;s certificate. It
                    is a one-time step on each device.
                  </p>
                  <p>
                    <a className="button" href="/certificate.cer" download="school-manager.cer">
                      Download the certificate
                    </a>
                  </p>
                  <ol className="connect__steps">
                    <li>
                      Open the downloaded file on the device and install it as a trusted
                      certificate.
                    </li>
                    <li>On a phone, allow the installation when the system asks.</li>
                    <li>Open the address again, and choose &ldquo;Add to Home screen&rdquo;.</li>
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
