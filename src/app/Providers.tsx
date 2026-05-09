"use client";

import { useState } from "react";
import {
  Toaster,
  ToasterComponent,
  ToasterProvider,
  ThemeProvider,
} from "@gravity-ui/uikit";

type ProvidersProps = {
  children: React.ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  const [toaster] = useState(() => new Toaster());

  return (
    <ThemeProvider theme="dark">
      <ToasterProvider toaster={toaster}>
        {children}
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  );
}
