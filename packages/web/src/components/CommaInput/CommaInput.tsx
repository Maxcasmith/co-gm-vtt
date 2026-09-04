import { useEffect, useState, type HTMLAttributes } from "react";
import { Input } from "../Input/Input";
import { Tag } from "../Tag/Tag";
import "./CommaInput.css";
import { useFormContext } from "../Form/Form";

interface iCommaInputProps<
  T extends string,
> extends HTMLAttributes<HTMLInputElement> {
  name: T;
  value: string;
  info: string;
  onTagUpdate?: (e: string) => void;
}

export function CommaInput<T extends string>(props: iCommaInputProps<T>) {
  const formContext = useFormContext();

  const { name, value, info, onTagUpdate, ...rest } = props;

  const [tags, setTags] = useState<string[]>(
    !value ? [] : value === "" ? [] : value.split(","),
  );
  const [dirtyVal, setDirtyVal] = useState("");

  const removeTag = (i: number) =>
    setTags((ts) => {
      delete ts[i];
      return ts.filter((t) => t);
    });

  // formContext is a new object every Form render (see Form.tsx) — including it here
  // would loop: this effect calls setForm, which re-renders Form, which recreates
  // formContext, which reruns this effect. Only tags should retrigger it.
  useEffect(() => {
    if (formContext) formContext.setForm({ [name]: tags.join(",") });
    if (onTagUpdate) onTagUpdate(tags.join(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags]);

  return (
    <>
      <p className="tags--info">{info}</p>
      <div className="tags--list--wrapper">
        {tags.map((t, i) => (
          <Tag key={`tag_${i}`}>
            {t} <span onClick={() => removeTag(i)}>✕</span>
          </Tag>
        ))}
      </div>
      <Input
        name="journey_tags"
        label='Tags (Separated by comma key ",")'
        onChange={(e) => {
          const char = e.nativeEvent.data;
          let val = e.target.value.replaceAll(",", "");
          if (char === "," && val.trim().replaceAll(",", "") !== "") {
            setTags([...tags, val.trimStart()]);
            val = "";
          }
          setDirtyVal(val);
        }}
        value={dirtyVal}
        {...rest}
      />
    </>
  );
}
