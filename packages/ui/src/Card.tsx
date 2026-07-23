import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function Card({ title, className, children, ...rest }: CardProps) {
  return (
    <div className={["fahrschul-card", className].filter(Boolean).join(" ")} {...rest}>
      {title ? <h3 className="fahrschul-card__title">{title}</h3> : null}
      {children}
    </div>
  );
}
