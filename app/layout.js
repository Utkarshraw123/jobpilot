import "./globals.css";

export const metadata = { title: "JobPilot", description: "Personal job search dashboard" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
