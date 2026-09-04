import { useState, useMemo } from "react";
import "./Calendar.css";
import { Button } from "../Button/Button";
import { useNavigate } from "react-router-dom";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  color?: string;
}

export interface CalendarProps {
  events?: CalendarEvent[];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// JS getDay: 0=Sun…6=Sat → convert to 0=Mon…6=Sun
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function formatSidebarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface CalendarCell {
  date: string;
  day: number;
  isCurrentMonth: boolean;
}

export function Calendar({ events = [] }: CalendarProps) {
  const navigate = useNavigate();
  const today = new Date();
  const todayStr = toDateString(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const eventMap = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      if (!map[event.date]) map[event.date] = [];
      map[event.date].push(event);
    }
    return map;
  }, [events]);

  const { cells, totalWeeks } = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startOffset = mondayIndex(firstDay);
    const currentMonthDays = daysInMonth(viewYear, viewMonth);
    const prevMonthDays = daysInMonth(viewYear, viewMonth - 1);

    const result: CalendarCell[] = [];

    // Trailing days from previous month
    for (let i = startOffset - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const pm = viewMonth === 0 ? 11 : viewMonth - 1;
      const py = viewMonth === 0 ? viewYear - 1 : viewYear;
      result.push({
        date: toDateString(py, pm, day),
        day,
        isCurrentMonth: false,
      });
    }

    // Current month
    for (let day = 1; day <= currentMonthDays; day++) {
      result.push({
        date: toDateString(viewYear, viewMonth, day),
        day,
        isCurrentMonth: true,
      });
    }

    // Leading days from next month
    const remaining = (7 - (result.length % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      const nm = viewMonth === 11 ? 0 : viewMonth + 1;
      const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
      result.push({
        date: toDateString(ny, nm, day),
        day,
        isCurrentMonth: false,
      });
    }

    return { cells: result, totalWeeks: result.length / 7 };
  }, [viewYear, viewMonth]);

  function prevMonth() {
    setDirection("prev");
    setAnimKey((k) => k + 1);
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    setDirection("next");
    setAnimKey((k) => k + 1);
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  }

  function handleDayClick(date: string) {
    setSelectedDate((prev) => (prev === date ? null : date));
  }

  const selectedEvents = selectedDate ? (eventMap[selectedDate] ?? []) : [];
  const sidebarOpen = selectedDate !== null;

  return (
    <div className="calendar--wrapper">
      <div className="calendar--main">
        <div className="calendar--header">
          <button className="calendar--nav--btn" onClick={prevMonth}>
            ‹
          </button>
          <span
            key={animKey}
            className={`calendar--month--label calendar--month--label--${direction}`}
          >
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button className="calendar--nav--btn" onClick={nextMonth}>
            ›
          </button>
        </div>

        <div className="calendar--day--headers">
          {DAYS.map((d) => (
            <div key={d} className="calendar--day--header">
              {d}
            </div>
          ))}
        </div>

        <div
          key={animKey}
          className={`calendar--grid calendar--grid--${direction}`}
          style={{ "--total-weeks": totalWeeks } as React.CSSProperties}
        >
          {cells.map(({ date, day, isCurrentMonth }) => {
            const dayEvents = eventMap[date] ?? [];
            const isToday = date === todayStr;
            const isSelected = date === selectedDate;
            const classNames = [
              "calendar--cell",
              !isCurrentMonth && "calendar--cell--faded",
              isToday && "calendar--cell--today",
              isSelected && "calendar--cell--selected",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={date}
                className={classNames}
                onClick={() => handleDayClick(date)}
              >
                <span className="calendar--cell--day">{day}</span>
                <div className="calendar--cell--events">
                  {dayEvents.map((event) => (
                    <div key={event.id} className="calendar--event--block">
                      {event.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`calendar--sidebar${sidebarOpen ? " calendar--sidebar--open" : ""}`}
      >
        <div className="calendar--sidebar--inner">
          <div className="calendar--sidebar--header">
            <span className="calendar--sidebar--date">
              {selectedDate ? formatSidebarDate(selectedDate) : ""}
            </span>
            <button
              className="calendar--sidebar--close"
              onClick={() => setSelectedDate(null)}
              aria-label="Close sidebar"
            >
              ✕
            </button>
          </div>

          <div className="calendar--sidebar--events">
            {selectedEvents.length === 0 ? (
              <p className="calendar--sidebar--empty">No events this day</p>
            ) : (
              selectedEvents.map((event) => (
                <div key={event.id} className="calendar--sidebar--event">
                  <span className="calendar--sidebar--event--dot" />
                  <span className="calendar--sidebar--event--title">
                    {event.title}
                  </span>
                </div>
              ))
            )}
          </div>

          <Button
            className="white rounded"
            onClick={() => navigate("create?date=" + selectedDate)}
          >
            New Event
          </Button>
        </div>
      </div>
    </div>
  );
}
