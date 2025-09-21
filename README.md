# TALON - Military Vehicle Load Planning Assistant

## Table of Contents
1. [App Overview](#app-overview)
2. [Purpose and Intent](#purpose-and-intent)
3. [User Guide](#user-guide)
4. [Architecture](#architecture)
5. [Developer Guide](#developer-guide)
6. [AI Configuration](#ai-configuration)
7. [Database Schema](#database-schema)
8. [Security](#security)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

## App Overview

TALON is a specialized AI-powered assistant designed for military vehicle load planning and transportation operations. It combines natural language processing with a comprehensive knowledge base to provide accurate, professional guidance on military logistics.

### Key Features
- **AI Chat Assistant**: Conversational interface for load planning queries
- **Knowledge Base Management**: Upload documents, URLs, and manual entries
- **Vector Search**: Semantic search through uploaded documents and knowledge
- **User Authentication**: Secure access with user profiles
- **Real-time Chat**: Interactive assistance with conversation history

## Purpose and Intent

### Mission Statement
TALON serves military personnel by providing instant access to load planning expertise, reducing the time required for complex logistics calculations and ensuring adherence to safety protocols and regulations.

### Target Users
- Military logistics officers
- Vehicle operators
- Transportation planners
- Equipment specialists
- Training personnel

### Core Capabilities
- Military vehicle specifications and capabilities analysis
- Load planning procedures and calculations
- Equipment and munition considerations
- Transportation logistics and operations guidance
- Infrastructure requirements assessment
- Safety protocols and regulations compliance

## User Guide

### Getting Started

1. **Authentication**
   - Navigate to `/auth` to sign up or log in
   - Use email and password authentication
   - New users are automatically redirected to the dashboard

2. **Dashboard Navigation**
   - **AI Chat Assistant**: Start interactive planning sessions
   - **Data Management**: Upload and manage knowledge base content

### Using the AI Chat Assistant

1. **Starting a Chat Session**
   - Click "Start Chat Session" from the dashboard
   - Begin with your load planning question or scenario
   - TALON will respond with relevant guidance and calculations

2. **Best Practices for Queries**
   - Be specific about vehicle types, load requirements, and constraints
   - Include relevant context (mission type, terrain, weather)
   - Ask follow-up questions to refine recommendations

3. **Understanding Responses**
   - TALON provides professional, actionable advice
   - Responses include relevant document excerpts when available
   - Citations show which knowledge base entries informed the response

### Data Management

1. **File Upload**
   - Supports PDF, DOCX, TXT, and other document formats
   - Maximum file size: 20MB
   - Documents are automatically processed and vectorized

2. **URL Processing**
   - Submit URLs to extract and index web content
   - Useful for incorporating online manuals and specifications

3. **Manual Knowledge Entry**
   - Add custom knowledge entries with title, content, and tags
   - Perfect for capturing institutional knowledge and procedures

## Architecture

### Technology Stack
- **Frontend**: React + TypeScript + Vite
- **UI Framework**: shadcn/ui + Tailwind CSS
- **Backend**: Supabase (Database, Auth, Storage, Edge Functions)
- **AI Services**: OpenAI GPT-4o-mini + text-embedding-ada-002
- **Vector Search**: PostgreSQL with pgvector extension

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React App     │    │   Supabase      │    │   OpenAI API    │
│                 │    │                 │    │                 │
│ ├─ Chat UI      │◄──►│ ├─ Database     │    │ ├─ GPT-4o-mini  │
│ ├─ Data Mgmt    │    │ ├─ Auth         │◄──►│ ├─ Embeddings   │
│ ├─ Auth         │    │ ├─ Storage      │    │                 │
│ └─ Dashboard    │    │ └─ Edge Funcs   │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Flow
1. User submits question via chat interface
2. Frontend sends message to `chat-with-talon` edge function
3. Edge function generates embedding for user query
4. Vector search retrieves relevant knowledge base entries
5. Context + query sent to OpenAI for response generation
6. AI response returned to user with source citations

## Developer Guide

### Project Structure
```
src/
├── components/
│   ├── ui/                 # shadcn/ui components
│   └── ProtectedRoute.tsx  # Authentication wrapper
├── hooks/
│   ├── useAuth.tsx         # Authentication state management
│   └── use-toast.ts        # Toast notifications
├── pages/
│   ├── Index.tsx           # Dashboard/landing page
│   ├── Auth.tsx            # Login/signup page
│   ├── Chat.tsx            # AI chat interface
│   ├── DataManagement.tsx  # Knowledge base management
│   └── NotFound.tsx        # 404 page
├── integrations/
│   └── supabase/
│       ├── client.ts       # Supabase client configuration
│       └── types.ts        # Auto-generated database types
└── lib/
    └── utils.ts            # Utility functions

supabase/
├── functions/
│   ├── chat-with-talon/    # Main AI chat endpoint
│   ├── process-document/   # Document processing
│   ├── process-url/        # URL content extraction
│   └── add-manual-knowledge/ # Manual entry processing
└── migrations/             # Database schema changes
```

### Key Development Areas

#### Frontend Components
- **Chat Interface** (`src/pages/Chat.tsx`): Main user interaction point
- **Data Management** (`src/pages/DataManagement.tsx`): Knowledge base administration
- **Authentication** (`src/hooks/useAuth.tsx`): User session management

#### Backend Edge Functions
- **chat-with-talon** (`supabase/functions/chat-with-talon/index.ts`): Core AI processing
- **process-document**: File upload and vectorization
- **process-url**: Web content extraction
- **add-manual-knowledge**: Manual entry processing

### Making Changes

#### Adding New Features
1. **Frontend Changes**: Create components in `src/components/` or pages in `src/pages/`
2. **Backend Logic**: Add edge functions in `supabase/functions/`
3. **Database Changes**: Use migration tool for schema updates
4. **Styling**: Follow design system in `src/index.css` and `tailwind.config.ts`

#### Modifying UI Components
- All UI components use the design system defined in `src/index.css`
- Colors are HSL-based and use CSS custom properties
- Follow existing patterns for consistency
- Use shadcn/ui components as base building blocks

#### Database Changes
- Use Supabase migration tool via Lovable interface
- Always include RLS policies for user data security
- Test migrations in development before production

## AI Configuration

### Modifying TALON's Behavior

The AI assistant's personality, expertise, and behavior are configured in the system prompt located in:

**File**: `supabase/functions/chat-with-talon/index.ts`
**Lines**: 74-87

```typescript
const systemPrompt = `You are TALON, a specialized AI assistant for military vehicle load planning and transportation operations. Your expertise includes:

- Military vehicle specifications and capabilities
- Load planning procedures and calculations
- Equipment and munition considerations
- Transportation logistics and operations
- Infrastructure requirements and constraints
- Safety protocols and regulations

Always provide accurate, professional, and actionable advice. If you don't have specific information, clearly state your limitations and suggest consulting official military documentation or subject matter experts.

${context ? `Use the following context information to inform your response:\n\n${context}` : ''}

Respond in a helpful, professional manner appropriate for military personnel.`;
```

### Customization Options

#### Changing AI Model
**Location**: `supabase/functions/chat-with-talon/index.ts`, lines 97-106
```typescript
model: 'gpt-4o-mini',  // Change to 'gpt-4' for more powerful responses
max_tokens: 1000,      // Adjust response length
temperature: 0.7,      // Control response creativity (0.0-1.0)
```

#### Modifying Expertise Areas
Edit the system prompt to add or remove areas of expertise:
- Add new domains (e.g., "Maritime logistics", "Air transport")
- Modify tone (e.g., "Respond in a casual, friendly manner")
- Change response format (e.g., "Always include numbered action items")

#### Adjusting Context Retrieval
**Location**: `supabase/functions/chat-with-talon/index.ts`, lines 30-45
```typescript
match_threshold: 0.7,  // Similarity threshold (0.0-1.0)
match_count: 5,        // Number of document chunks to retrieve
```

#### Response Processing
**Location**: `supabase/functions/chat-with-talon/index.ts`, lines 68-71
```typescript
const recentHistory = conversationHistory?.slice(-6) || []; // Conversation memory length
```

### Adding New Edge Functions

1. Create new function directory: `supabase/functions/your-function-name/`
2. Add `index.ts` with edge function code
3. Configure environment variables if needed
4. Functions deploy automatically

## Database Schema

### Core Tables

#### `profiles`
```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  user_id uuid NOT NULL,
  display_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `documents`
```sql
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  filename text NOT NULL,
  file_size bigint,
  mime_type text,
  upload_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
```

#### `knowledge_base`
```sql
CREATE TABLE public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  tags text[],
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);
```

#### `document_chunks`
```sql
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536),
  chunk_index integer,
  created_at timestamptz DEFAULT now()
);
```

### Vector Search Functions

#### `search_chunks(query_embedding, match_threshold, match_count)`
Searches document chunks using vector similarity

#### `search_knowledge(query_embedding, match_threshold, match_count)`
Searches knowledge base entries using vector similarity

## Security

### Row Level Security (RLS)

All user data tables implement RLS policies:

```sql
-- Users can only access their own data
CREATE POLICY "Users can view their own profile" 
ON public.profiles FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own documents" 
ON public.documents FOR ALL 
USING (auth.uid() = user_id);
```

### Authentication
- Email/password authentication via Supabase Auth
- Session-based authentication with automatic token refresh
- Protected routes require valid authentication

### API Security
- Edge functions validate user authentication
- CORS headers configured for secure cross-origin requests
- Environment variables protect API keys

### Data Privacy
- User data is isolated by user ID
- Vector embeddings contain no personally identifiable information
- File uploads are processed and stored securely

## Deployment

### Environment Variables (Supabase Secrets)
Required secrets for production:
- `OPENAI_API_KEY`: OpenAI API access
- `SUPABASE_URL`: Auto-configured
- `SUPABASE_SERVICE_ROLE_KEY`: Auto-configured

### Deployment Steps via Lovable
1. Click "Publish" in the Lovable interface
2. Configure custom domain if needed (Project > Settings > Domains)
3. Edge functions deploy automatically
4. Database migrations apply automatically

### Manual Deployment
1. Build the React app: `npm run build`
2. Deploy to hosting provider (Vercel, Netlify, etc.)
3. Configure environment variables
4. Ensure Supabase project is configured correctly

## Troubleshooting

### Common Issues

#### Authentication Problems
- **Symptom**: Users can't log in
- **Solution**: Check authentication providers in Supabase dashboard
- **Location**: https://supabase.com/dashboard/project/{project_id}/auth/providers

#### AI Chat Not Responding
- **Symptom**: Chat messages fail or timeout
- **Causes**: 
  - Missing `OPENAI_API_KEY` secret
  - OpenAI API quota exceeded
  - Network connectivity issues
- **Debug**: Check edge function logs

#### Vector Search Issues
- **Symptom**: AI responses lack relevant context
- **Causes**:
  - Documents not properly processed
  - Embedding generation failed
  - Low similarity threshold
- **Solution**: Re-upload documents, check processing status

#### Upload Failures
- **Symptom**: Document uploads fail
- **Causes**:
  - File size exceeds 20MB limit
  - Unsupported file format
  - Storage bucket permissions
- **Solution**: Check file size, format, and storage policies

### Debugging Tools

#### Edge Function Logs
Access via: https://supabase.com/dashboard/project/{project_id}/functions/{function_name}/logs

#### Database Queries
Use SQL Editor: https://supabase.com/dashboard/project/{project_id}/sql/new

#### Network Inspection
- Browser developer tools
- Check API response status codes
- Verify request/response headers

### Performance Optimization

#### Vector Search Tuning
- Adjust `match_threshold` for better relevance
- Increase `match_count` for more context
- Monitor query performance

#### Response Time
- Cache frequently accessed knowledge
- Optimize document chunk size
- Use appropriate OpenAI model for use case

---

## Contributing

When contributing to TALON development:

1. **Follow Design System**: Use semantic tokens from `src/index.css`
2. **Test Security**: Verify RLS policies work correctly
3. **Document Changes**: Update this documentation for significant changes
4. **Edge Function Changes**: Test thoroughly before deployment
5. **Database Changes**: Use migration tool, never edit types directly

For questions or support, refer to the Lovable documentation or contact the development team.
