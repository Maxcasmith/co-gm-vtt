export type FormDataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | File
  | Blob
  | FormDataValue[]
  | { [key: string]: FormDataValue };

function appendToFormData(
  fd: FormData,
  value: FormDataValue,
  key: string,
): void {
  if (value === null || value === undefined) {
    return; // skip nullish by default
  }

  if (value instanceof File) {
    fd.append(key, value, value.name);
  } else if (value instanceof Blob) {
    fd.append(key, value);
  } else if (value instanceof Date) {
    fd.append(key, value.toISOString());
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendToFormData(fd, item, `${key}[${index}]`);
    });
  } else if (typeof value === "object") {
    Object.entries(value).forEach(([field, val]) => {
      appendToFormData(fd, val, `${key}[${field}]`);
    });
  } else {
    fd.append(key, String(value));
  }
}

export function toFormData(body: Record<string, FormDataValue>): FormData {
  const fd = new FormData();
  Object.entries(body).forEach(([key, value]) => {
    appendToFormData(fd, value, key);
  });
  return fd;
}
