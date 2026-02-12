export const metadata = {
  title: "Nutrition Platform",
  description: "Diet builder for athletes",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, Arial" }}>{children}</body>
    </html>
  );
}
