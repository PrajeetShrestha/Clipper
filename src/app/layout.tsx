import './style.css';
export const metadata = { title: 'Clipper', description: 'Create captioned clips from YouTube videos' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
