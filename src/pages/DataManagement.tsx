import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, Link, Trash2, Eye, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Document {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  upload_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

const DataManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [processingUrl, setProcessingUrl] = useState(false);
  
  // Form states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [manualTags, setManualTags] = useState('');

  // Load documents
  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  const loadDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data?.map(doc => ({
        ...doc,
        upload_status: doc.upload_status as 'pending' | 'processing' | 'completed' | 'failed'
      })) || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to load documents",
        description: error.message,
      });
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile || !user) return;

    setUploadingFile(true);
    try {
      // Upload file to Supabase Storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      // Create document record
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          filename: selectedFile.name,
          file_path: uploadData.path,
          file_size: selectedFile.size,
          mime_type: selectedFile.type,
          upload_status: 'pending',
          user_id: user.id
        })
        .select()
        .single();

      if (docError) throw docError;

      // Process the document
      await processDocument(docData.id, uploadData.path);
      
      setSelectedFile(null);
      loadDocuments();
      
      toast({
        title: "File uploaded successfully",
        description: "Your file is being processed and will be available for RAG soon.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlInput.trim() || !user) return;

    setProcessingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-url', {
        body: { url: urlInput.trim() }
      });

      if (error) throw error;

      setUrlInput('');
      loadDocuments();
      
      toast({
        title: "URL processed successfully",
        description: "Content from the URL has been added to your knowledge base.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "URL processing failed",
        description: error.message,
      });
    } finally {
      setProcessingUrl(false);
    }
  };

  const handleManualEntry = async () => {
    if (!manualTitle.trim() || !manualContent.trim() || !user) return;

    setLoading(true);
    try {
      const tags = manualTags.split(',').map(tag => tag.trim()).filter(Boolean);
      
      const { error } = await supabase.functions.invoke('add-manual-knowledge', {
        body: {
          title: manualTitle.trim(),
          content: manualContent.trim(),
          tags
        }
      });

      if (error) throw error;

      setManualTitle('');
      setManualContent('');
      setManualTags('');
      
      toast({
        title: "Knowledge entry added",
        description: "Your manual entry has been processed and added to the knowledge base.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to add entry",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const processDocument = async (documentId: string, filePath: string) => {
    try {
      await supabase.functions.invoke('process-document', {
        body: { documentId, filePath }
      });
    } catch (error) {
      console.error('Failed to process document:', error);
    }
  };

  const deleteDocument = async (docId: string) => {
    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId);

      if (error) throw error;
      
      loadDocuments();
      toast({
        title: "Document deleted",
        description: "The document and its chunks have been removed.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message,
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'processing': return <AlertCircle className="h-4 w-4 text-blue-500" />;
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return null;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Data Management</h1>
        <p className="text-muted-foreground">
          Upload files, add URLs, or create manual entries to expand TALON's knowledge base
        </p>
      </div>

      <Tabs defaultValue="upload" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upload">File Upload</TabsTrigger>
          <TabsTrigger value="url">URL Processing</TabsTrigger>
          <TabsTrigger value="manual">Manual Entry</TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Documents
              </CardTitle>
              <CardDescription>
                Upload PDF, Word, text files, and more. Files will be automatically processed and chunked for RAG.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="file-upload">Select File</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                {selectedFile && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </p>
                )}
              </div>
              <Button 
                onClick={handleFileUpload} 
                disabled={!selectedFile || uploadingFile}
                className="w-full"
              >
                {uploadingFile ? 'Uploading...' : 'Upload and Process'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="url">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link className="h-5 w-5" />
                Process URL
              </CardTitle>
              <CardDescription>
                Extract and process content from web pages, documentation sites, or online resources.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="url-input">Website URL</Label>
                <Input
                  id="url-input"
                  type="url"
                  placeholder="https://example.com/document"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
              </div>
              <Button 
                onClick={handleUrlSubmit} 
                disabled={!urlInput.trim() || processingUrl}
                className="w-full"
              >
                {processingUrl ? 'Processing...' : 'Process URL'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Manual Entry
              </CardTitle>
              <CardDescription>
                Add custom knowledge entries, procedures, or information directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="manual-title">Title</Label>
                <Input
                  id="manual-title"
                  placeholder="Vehicle Loading Procedures"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="manual-content">Content</Label>
                <Textarea
                  id="manual-content"
                  placeholder="Enter detailed information about military vehicle loading procedures..."
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  rows={8}
                />
              </div>
              <div>
                <Label htmlFor="manual-tags">Tags (comma-separated)</Label>
                <Input
                  id="manual-tags"
                  placeholder="vehicles, loading, procedures, military"
                  value={manualTags}
                  onChange={(e) => setManualTags(e.target.value)}
                />
              </div>
              <Button 
                onClick={handleManualEntry} 
                disabled={!manualTitle.trim() || !manualContent.trim() || loading}
                className="w-full"
              >
                {loading ? 'Adding...' : 'Add to Knowledge Base'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle>Uploaded Documents</CardTitle>
          <CardDescription>
            Track the status of your uploaded documents and their processing progress.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No documents uploaded yet. Start by uploading your first document above.
            </p>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(doc.upload_status)}
                    <div>
                      <p className="font-medium">{doc.filename}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatFileSize(doc.file_size)}</span>
                        <Badge variant={doc.upload_status === 'completed' ? 'default' : 'secondary'}>
                          {doc.upload_status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteDocument(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DataManagement;