import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A2W Infra Agent",
  description: "Agent-native infrastructure operations with Terraform, GitOps, and sandboxed execution."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
