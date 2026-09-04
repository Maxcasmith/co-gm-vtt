import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type DragEvent,
  type ChangeEvent,
  type HTMLAttributes,
} from "react";
import "./FileUploader.css";
import { useFormContext } from "../Form/Form";
import { Button } from "../Button/Button";

interface FileUploaderProps<
  T extends string,
> extends HTMLAttributes<HTMLDivElement> {
  name: T;
  label: string;
  multi: boolean;
  accept: string;
  onFilesChange: (files: File[]) => void;
  errors: Map<string, string[]>;
}

export function FileUploader<T extends string>(
  props: Partial<FileUploaderProps<T>>,
) {
  const formContext = useFormContext();

  const {
    name = "",
    label = name,
    multi = false,
    accept,
    className,
    errors = formContext ? formContext.errors : new Map(),
    onFilesChange,
    ...rest
  } = props;

  const contextFiles: File[] = formContext
    ? (formContext.form[name] ?? [])
    : [];
  const [files, setFiles] = useState<File[]>(contextFiles);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Derived from files — recomputed (and old object URLs revoked) whenever files changes.
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    files.forEach((file, i) => {
      const key = `${file.name}_${i}`;
      if (file.type.startsWith("image/")) {
        map.set(key, URL.createObjectURL(file));
      }
    });
    return map;
  }, [files]);

  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  const commitFiles = (next: File[]) => {
    setFiles(next);
    if (formContext) formContext.setForm({ [name]: next });
    onFilesChange?.(next);
  };

  const addFiles = (incoming: File[]) => {
    const next = multi ? [...files, ...incoming] : incoming.slice(0, 1);
    commitFiles(next);
  };

  const removeFile = (index: number) => {
    commitFiles(files.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) addFiles(dropped);
  };

  const handleClick = () => inputRef.current?.click();

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) addFiles(selected);
    e.target.value = "";
  };

  const showDropzone = multi || files.length === 0;

  return (
    <div
      className={`file-uploader--wrapper${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <span className="file-uploader--label">{label}</span>
      {showDropzone && (
        <div
          className={`file-uploader--dropzone${isDragging ? " dragging" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multi}
            onChange={handleInputChange}
            className="file-uploader--hidden-input"
          />
          {isDragging ? (
            <UploadIcon />
          ) : (
            <span className="file-uploader--prompt">
              Click or drag a file here to upload
            </span>
          )}
        </div>
      )}

      {files.length > 0 && (
        <ul className="file-uploader--file-list">
          {files.map((file, i) => {
            const key = `${file.name}_${i}`;
            const preview = previews.get(key);
            return (
              <li key={key} className="file-uploader--file-item">
                <div className="file-uploader--file-preview">
                  {preview ? (
                    <img
                      src={preview}
                      alt={file.name}
                      className="file-uploader--preview-img"
                    />
                  ) : (
                    <FileIcon />
                  )}
                </div>
                <span className="file-uploader--file-name">{file.name}</span>
                <Button
                  className="transparent text-danger"
                  onClick={() => removeFile(i)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {errors.get(name) && (
        <div className="input--errors--container">
          <span>Please address the following errors</span>
          <ul>
            {errors.get(name).map((e: string, i: number) => (
              <li key={`err_${i}`}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  );
}
