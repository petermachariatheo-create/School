import { useState } from "react";
import type { ServerInfo } from "../app/server.ts";
import { Button } from "../ui/Button.tsx";

/**
 * The first thing a new user sees.
 *
 * The screen has one job: turn an empty application into a school somebody
 * can use. It asks for the name of the school, and then it explains how to
 * get the school onto a phone or a tablet.
 */

export interface WelcomeProps {
  readonly info: ServerInfo | null;
  readonly onComplete: (schoolName: string) => void;
  /** Opens the "add another device" panel. */
  readonly onShowConnect: () => void;
}

export function Welcome({ info, onComplete, onShowConnect }: WelcomeProps): React.ReactNode {
  const [schoolName, setSchoolName] = useState("");

  const submit = (): void => {
    const name = schoolName.trim();
    onComplete(name === "" ? "School Manager" : name);
  };

  return (
    <div className="welcome">
      <div className="welcome__card">
        <span className="welcome__mark" aria-hidden="true" />
        <h1 className="welcome__title">Welcome to School Manager</h1>
        <p className="welcome__lead">
          This computer holds the school&rsquo;s records. Everything you do is saved here first and
          sent to the other devices when they can be reached.
        </p>

        <div className="field">
          <div className="field__head">
            <label htmlFor="welcome-name">What is the school called?</label>
          </div>
          <input
            id="welcome-name"
            type="text"
            placeholder="Greenwood Secondary School"
            value={schoolName}
            onChange={(event) => setSchoolName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submit();
              }
            }}
          />
        </div>

        <Button variant="primary" className="welcome__start" onClick={submit}>
          Get started
        </Button>

        <div className="welcome__devices">
          <h3>Using a phone or a tablet?</h3>
          <p className="field__hint">
            {info === null
              ? "Once the school server is running, this computer can show you the address to open on another device."
              : "This computer can show you the address to open on another device, and a code to scan."}
          </p>
          <Button onClick={onShowConnect}>Show me how</Button>
        </div>
      </div>
    </div>
  );
}
