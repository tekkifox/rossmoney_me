import type { CollectionConfig } from 'payload';

/**
 * Optional project link. Empty values are valid so existing documents keep
 * working; anything entered has to be an absolute http(s) address.
 */
export const validateProjectUrl = (value: unknown): string | true => {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') {
    return 'Enter an absolute http:// or https:// URL, for example https://example.com/project';
  }

  const trimmed = value.trim();
  if (!trimmed) return true;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Enter an absolute http:// or https:// URL, for example https://example.com/project';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The link must start with http:// or https://';
  }
  if (url.username || url.password) {
    return 'The link must not contain credentials';
  }

  return true;
};

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'role', 'order'],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'role',
      type: 'text',
    },
    {
      name: 'summary',
      type: 'textarea',
    },
    {
      name: 'url',
      type: 'text',
      admin: {
        description:
          'Optional. Absolute http:// or https:// address the "Selected work" card links to, such as a live project or case study. Leave empty to show the card without a link.',
      },
      validate: validateProjectUrl,
    },
    {
      name: 'tags',
      type: 'array',
      fields: [
        {
          name: 'tag',
          type: 'text',
        },
      ],
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 1,
    },
  ],
};
