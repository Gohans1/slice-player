import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        red: "border-flexoki-red/30 bg-flexoki-red/15 text-flexoki-red",
        orange: "border-flexoki-orange/30 bg-flexoki-orange/15 text-flexoki-orange",
        yellow: "border-flexoki-yellow/30 bg-flexoki-yellow/15 text-flexoki-yellow",
        green: "border-flexoki-green/30 bg-flexoki-green/15 text-flexoki-green",
        cyan: "border-flexoki-cyan/30 bg-flexoki-cyan/15 text-flexoki-cyan",
        blue: "border-flexoki-blue/30 bg-flexoki-blue/15 text-flexoki-blue",
        purple: "border-flexoki-purple/30 bg-flexoki-purple/15 text-flexoki-purple",
        magenta: "border-flexoki-magenta/30 bg-flexoki-magenta/15 text-flexoki-magenta",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
