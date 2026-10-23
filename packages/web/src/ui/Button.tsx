import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type AnyIconName } from "./icons.tsx";

/**
 * The button.
 *
 * One component for every button in the interface, so that the size, the
 * icon and the emphasis are decided in one place. A screen that mixes
 * three different button styles reads as three different applications.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** How much the button stands out. */
  readonly variant?: ButtonVariant;
  /** The size of the button. */
  readonly size?: "sm" | "md";
  /** An icon to show beside the label. */
  readonly icon?: AnyIconName;
  /** Whether the icon leads or follows the label. */
  readonly iconPosition?: "start" | "end";
  /** Where the focus goes when the button is shown. */
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "start",
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps): React.ReactNode {
  const classes = ["button", `button--${variant}`, `button--${size}`];
  if (className !== undefined) {
    classes.push(className);
  }

  return (
    <button {...rest} type={type} className={classes.join(" ")}>
      {icon !== undefined && iconPosition === "start" ? <Icon name={icon} /> : null}
      {children}
      {icon !== undefined && iconPosition === "end" ? <Icon name={icon} /> : null}
    </button>
  );
}
