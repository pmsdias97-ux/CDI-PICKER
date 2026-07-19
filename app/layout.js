import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fonte principal da app: Inter (auto-hospedada, consistente em todos os dispositivos).
const appSans = Inter({
  variable: "--font-app",
  subsets: ["latin"],
});

export const metadata = {
  title: "CDI PICKER",
  description: "O jogo de portefólios da nossa comunidade. Escolhe 8 ações, submete o teu portefólio e compete pelo melhor retorno.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${appSans.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: extensões (ex.: Grammarly) injetam atributos
          no <body> antes da hidratação, causando um mismatch benigno. */}
      {/* NOTA: SEM `flex flex-col` no body. No Safari iOS, um flex container no body faz os
          position:fixed descendentes (ex.: FABs) serem posicionados relativos ao container e não à
          viewport → "flutuam"/prendem-se ao centro ao fazer scroll. min-h-full chega p/ a altura. */}
      <body className="min-h-full" suppressHydrationWarning>{children}</body>
    </html>
  );
}
