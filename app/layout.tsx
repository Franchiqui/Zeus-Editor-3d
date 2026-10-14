import './globals.css';
import '../zeus-icons.js';
import '../zeus-styles.css';
import Script from 'next/script';
import { Providers } from '@/components/Providers';
import { ComponentSelectorHelper } from '@/components/component-selector-helper';
import { ChatProvider } from '@/components/ChatContext';
import { AIEditorBridgeProvider } from '@/components/AIEditorBridgeContext';
import { metadata } from './metadata';

export { metadata };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="bg-gray-950 text-white min-h-screen">
        <Providers>
          <AIEditorBridgeProvider>
            <ChatProvider>
              <ComponentSelectorHelper />
              {children}

            </ChatProvider>
          </AIEditorBridgeProvider>
        </Providers>
      </body>
      <Script src="http://localhost:3030/inspector-client.js" strategy="afterInteractive" />
    </html>
  );
}