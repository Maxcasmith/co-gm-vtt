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
