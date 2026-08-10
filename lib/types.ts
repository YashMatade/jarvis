export interface ProfileCardLink {
  label: string;
  url: string;
}

export interface ProfileCardField {
  label: string;
  value: string;
}

// In your types file
export interface ProfileCardData {
  name: string;
  subtitle?: string;
  summary?: string;
  image?: string; // URL to the profile image
  status?: string; // Optional status indicator
  fields?: Array<{
    label: string;
    value: string;
  }>;
  links?: Array<{
    label: string;
    url: string;
  }>;
}
