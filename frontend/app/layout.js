import "./globals.css";

export const metadata = {
  title: "NexusMemory Enterprise // Autonomous SRE Operating System",
  description: "Enterprise SRE Incident Intelligence Platform with In-Office Verification and Hindsight Memory",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
