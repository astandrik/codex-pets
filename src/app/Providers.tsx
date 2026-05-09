"use client";

import { ThemeProvider } from "@gravity-ui/uikit";

type ProvidersProps = {
  children: React.ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return <ThemeProvider theme="dark">{children}</ThemeProvider>;
}
