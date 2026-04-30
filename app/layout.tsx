import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A2W-Codex-Terraform-v0.0.1",
  description: "Agent-native infrastructure operations with Terraform, GitOps, and sandboxed execution.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/a2w-codex-logo.png", sizes: "684x684", type: "image/png" }
    ],
    apple: [{ url: "/a2w-codex-logo.png", sizes: "684x684", type: "image/png" }]
  }
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
      <body>
        <div className="app-frame">{children}</div>
      </body>
    </html>
  );
}
