import { Tooltip } from "./Tooltip";

/**
 * One of a few named choices, where a dropdown would hide the options that
 * matter. The hint rides a tooltip rather than the line, so the group stays one
 * row however many choices it holds.
 */
export function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string; hint?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {options.map((option) => {
        const control = (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="radio"
              name={name}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
            />
            {option.label}
          </label>
        );
        return option.hint ? (
          <Tooltip key={option.id} content={option.hint}>
            {control}
          </Tooltip>
        ) : (
          <span key={option.id}>{control}</span>
        );
      })}
    </div>
  );
}
