import { useEffect, useState } from 'react';
import { on } from './events.ts';

interface Quote {
  text: string;
  senderName: string;
  key: number;
}

export default function ChatWidget() {
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    return on('vtt:chat:message-received', ({ text, senderName }) => {
      setQuote({ text, senderName, key: Date.now() });
    });
  }, []);

  if (!quote) return null;

  return (
    <div className="chat-widget">
      <p
        key={quote.key}
        className="chat-widget-quote"
        onAnimationEnd={() => setQuote(null)}
      >
        &#x201C;{quote.text}&#x201D;
        <span className="chat-widget-sender"> — {quote.senderName}</span>
      </p>
    </div>
  );
}
