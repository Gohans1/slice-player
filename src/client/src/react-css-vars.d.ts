import "react";

// Lets style props set CSS custom properties such as "--slice-color" without a type assertion
declare module "react" {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
