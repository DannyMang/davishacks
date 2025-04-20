export interface FileDocumentation {
    path: string;
    lastUpdated: string;
    content: string;
    summary: string;
    type: string;
    hash?: string; // Git hash when last documented
    preview: string;
}

export interface ProjectDocumentation {
    version: string;
    lastUpdated: string;
    files: Record<string, FileDocumentation>;
} 