import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';
import { GoogleGenAI } from "@google/genai";
import { FileDocumentation, ProjectDocumentation } from '../types/docs.js';
import * as dotenv from 'dotenv';

// Debug logging setup
const DEBUG = true;
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'davishacks-debug.log');

// Initialize logging
try {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
} catch (error) {
    console.error('Failed to initialize logging:', error);
}

const debugLog = (message: string) => {
    if (DEBUG) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        try {
            fs.appendFileSync(LOG_FILE, logMessage);
        } catch (error) {
            // Silently fail as we can't use console.log during operations
        }
    }
};

debugLog('DocManager logging initialized');

// Load environment variables
dotenv.config();

const apiKey = process.env['GOOGLE_API_KEY'];
if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set in environment variables');
}

export class DocManager {
    private docsPath: string;
    private htmlPath: string;
    private git: SimpleGit;
    private genAI: GoogleGenAI;
    private projectDocs: ProjectDocumentation;
    private workspacePath: string;

    constructor(workspacePath: string) {
        debugLog(`Initializing DocManager with workspace path: ${workspacePath}`);
        this.workspacePath = workspacePath;
        this.docsPath = path.join(workspacePath, 'docs');
        this.htmlPath = path.join(this.docsPath, 'html');
        this.git = simpleGit(workspacePath);
        
        // Initialize Google Gemini
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY is not set in environment variables');
        }
        this.genAI = new GoogleGenAI({ apiKey: apiKey});

        // Create docs directory if it doesn't exist
        if (!fs.existsSync(this.docsPath)) {
            debugLog(`Creating docs directory at: ${this.docsPath}`);
            fs.mkdirSync(this.docsPath, { recursive: true });
            fs.mkdirSync(this.htmlPath, { recursive: true });
        }

        // Load or initialize project documentation
        this.projectDocs = this.loadDocs();
        debugLog('DocManager initialization complete');
    }

    private loadDocs(): ProjectDocumentation {
        const docsFile = path.join(this.docsPath, 'docs.json');
        debugLog(`Loading docs from: ${docsFile}`);
        
        if (fs.existsSync(docsFile)) {
            return JSON.parse(fs.readFileSync(docsFile, 'utf-8'));
        }
        debugLog('No existing docs found, creating new documentation structure');
        return {
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            files: {}
        };
    }
    

    private saveDocs() {
        const docsFile = path.join(this.docsPath, 'docs.json');
        debugLog(`Saving docs to: ${docsFile}`);
        fs.writeFileSync(docsFile, JSON.stringify(this.projectDocs, null, 2));
    }

    async getChangedFiles(): Promise<string[]> {
        const status = await this.git.status();
        return [
            ...status.modified,
            ...status.not_added,
            ...status.created
        ];
    }

    private getFilePreview(filePath: string): string {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').slice(0, 5); // Get first 5 lines
            return lines.join('\n') + (lines.length >= 5 ? '\n...' : '');
        } catch (error) {
            debugLog(`Error getting file preview for ${filePath}: ${error}`);
            return 'Unable to read file content';
        }
    }


    async generateDocumentation(filePath: string): Promise<FileDocumentation> {
        try {
            debugLog(`Generating documentation for file: ${filePath}`);
            debugLog(`Workspace path: ${this.workspacePath}`);
            
            // Remove any leading davishacks from the file path
            const normalizedFilePath = filePath.replace(/^davishacks\//, '');
            
            // Convert relative path to absolute path
            const absolutePath = path.join(this.workspacePath, normalizedFilePath);
            
            debugLog(`Normalized file path: ${normalizedFilePath}`);
            debugLog(`Resolved absolute path: ${absolutePath}`);
            
            if (!fs.existsSync(absolutePath)) {
                debugLog(`File does not exist at path: ${absolutePath}`);
                throw new Error(`File not found: ${absolutePath}`);
            }

            const content = fs.readFileSync(absolutePath, 'utf-8');
            const fileType = path.extname(absolutePath).slice(1);
            debugLog(`File type: ${fileType}`);
            
            // Generate a more concise summary focusing on methods and key functionality
            const prompt = `Please provide a concise technical summary of this ${fileType} code file. Focus only on:
            1. The main purpose of the file
            2. Each method/function with a one-line description
            3. Key data structures or types
            Keep the summary under 200 words and use bullet points for clarity.

            Code:
            ${content}`;
                        
            debugLog('Generating AI summary...');
            const response = await this.genAI.models.generateContent({
                model: "gemini-2.0-flash",
                contents: prompt,
            });

            const summary = response.text;
            debugLog('AI summary generated successfully');

            const doc: FileDocumentation = {
                path: filePath,
                lastUpdated: new Date().toISOString(),
                content,
                summary: summary || '',
                type: fileType,
                hash: (await this.git.revparse(['HEAD'])) || undefined,
                preview: this.getFilePreview(absolutePath)
            };

            this.projectDocs.files[filePath] = doc;
            this.projectDocs.lastUpdated = new Date().toISOString();
            this.saveDocs();

            // Also save individual file documentation
            const fileDocPath = path.join(this.docsPath, 'files', `${path.basename(filePath)}.json`);
            debugLog(`Saving individual file documentation to: ${fileDocPath}`);
            fs.mkdirSync(path.dirname(fileDocPath), { recursive: true });
            fs.writeFileSync(fileDocPath, JSON.stringify(doc, null, 2));

            debugLog(`Documentation generated successfully for: ${filePath}`);
            return doc;
        } catch (error) {
            debugLog(`Error generating documentation for ${filePath}: ${error}`);
            throw error;
        }
    }

    async generateAllDocumentation(files: string[]): Promise<void> {
        debugLog('Starting bulk documentation generation');
        for (const file of files) {
            try {
                // Check if file has changed since last documentation
                const existingDoc = this.getDocumentation(file);
                if (existingDoc) {
                    const stats = fs.statSync(path.join(this.workspacePath, file.replace(/^davishacks\//, '')));
                    const lastModified = new Date(stats.mtime).toISOString();
                    
                    if (lastModified <= existingDoc.lastUpdated) {
                        debugLog(`Skipping unchanged file: ${file}`);
                        continue;
                    }
                }
                
                await this.generateDocumentation(file);
            } catch (error) {
                debugLog(`Error generating documentation for ${file}: ${error}`);
                // Continue with other files even if one fails
            }
        }
        debugLog('Bulk documentation generation complete');
    }

    async generateHtml() {
        const template = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Project Documentation</title>
            <style>
                body { font-family: system-ui; max-width: 1200px; margin: 0 auto; padding: 20px; }
                .file { margin-bottom: 30px; border: 1px solid #eee; padding: 20px; border-radius: 8px; }
                pre { background: #f6f8fa; padding: 15px; border-radius: 6px; overflow-x: auto; }
                .summary { margin: 15px 0; padding: 15px; background: #f0f7ff; border-radius: 6px; }
            </style>
        </head>
        <body>
            <h1>Project Documentation</h1>
            <p>Last updated: ${this.projectDocs.lastUpdated}</p>
            ${Object.values(this.projectDocs.files).map(file => `
                <div class="file">
                    <h2>${file.path}</h2>
                    <div class="summary">
                        <h3>Summary</h3>
                        <p>${file.summary}</p>
                    </div>
                    <h3>Source Code</h3>
                    <pre><code>${file.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
                </div>
            `).join('\n')}
        </body>
        </html>
        `;

        fs.writeFileSync(path.join(this.htmlPath, 'index.html'), template);
    }

    getDocumentation(filePath: string): FileDocumentation | undefined {
        return this.projectDocs.files[filePath];
    }
} 
