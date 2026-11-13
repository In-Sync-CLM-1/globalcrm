import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/common/LoadingState";
import { useNotification } from "@/hooks/useNotification";
import { MessageSquare, Mail, Search, Send, User, Plus, Download, RefreshCw, Inbox, MessageCircle, User2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "date-fns";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV, ExportColumn, formatDateForExport } from "@/utils/exportUtils";
import { useUrlState } from "@/hooks/useUrlState";

interface ConversationItem {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  channel: string;
  direction: string;
  sender_name: string | null;
  preview: string;
  is_read: boolean;
  sent_at: string;
  contact_name: string | null;
  phone_number: string | null;
  email_address: string | null;
}

interface Message {
  id: string;
  direction: string;
  message_content?: string;
  email_content?: string;
  subject?: string;
  sent_at: string;
  status: string;
  sender_name?: string;
  from_name?: string;
}

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  created_at: string;
}

export default function Communications() {
  const { effectiveOrgId } = useOrgContext();
  const navigate = useNavigate();
  const notify = useNotification();
  const queryClient = useQueryClient();
  const [filteredConversations, setFilteredConversations] = useState<ConversationItem[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelFilter, setChannelFilter] = useUrlState<string>("channel", "all");
  const [searchQuery, setSearchQuery] = useUrlState("q", "");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [mainTab, setMainTab] = useUrlState<string>("tab", "conversations");
  const [emailCampaignSearch, setEmailCampaignSearch] = useUrlState("cq", "");

  // Fetch conversations with React Query
  const { data: conversations = [], isLoading: loading, refetch: refetchConversations } = useQuery({
    queryKey: ['conversations', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];

      const { data, error } = await supabase.rpc('get_unified_inbox', {
        p_org_id: effectiveOrgId,
        p_limit: 100,
      });

      if (error) throw error;
      return (data || []) as ConversationItem[];
    },
    enabled: !!effectiveOrgId,
  });

  useEffect(() => {
    if (effectiveOrgId) {
      subscribeToUpdates();
    }
  }, [effectiveOrgId]);

  useEffect(() => {
    filterConversations();
  }, [conversations, channelFilter, searchQuery]);

  const filterConversations = () => {
    let filtered = conversations;

    if (channelFilter !== "all") {
      filtered = filtered.filter((c) => c.channel === channelFilter);
    }

    if (searchQuery) {
      filtered = filtered.filter((c) =>
        c.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.preview?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredConversations(filtered);
  };

  const subscribeToUpdates = () => {
    const whatsappChannel = supabase
      .channel('whatsapp-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `org_id=eq.${effectiveOrgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations', effectiveOrgId] });
          if (activeConversation?.channel === 'whatsapp') {
            fetchMessages(activeConversation.conversation_id, 'whatsapp');
          }
        }
      )
      .subscribe();

    const emailChannel = supabase
      .channel('email-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'email_conversations',
          filter: `org_id=eq.${effectiveOrgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations', effectiveOrgId] });
          if (activeConversation?.channel === 'email') {
            fetchMessages(activeConversation.conversation_id, 'email');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(whatsappChannel);
      supabase.removeChannel(emailChannel);
    };
  };

  const fetchMessages = async (conversationId: string, channel: string) => {
    try {
      if (channel === 'whatsapp') {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('sent_at', { ascending: true });

        if (error) throw error;
        setMessages(data || []);
      } else if (channel === 'email') {
        const { data, error } = await supabase
          .from('email_conversations')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('sent_at', { ascending: true });

        if (error) throw error;
        setMessages(data || []);
      }
    } catch (error: any) {
      notify.error("Error loading messages", error);
    }
  };

  const handleConversationClick = (conversation: ConversationItem) => {
    setActiveConversation(conversation);
    fetchMessages(conversation.conversation_id, conversation.channel);
    
    // Mark as read
    if (!conversation.is_read && conversation.direction === 'inbound') {
      markAsRead(conversation.id, conversation.channel);
    }
  };

  const markAsRead = async (messageId: string, channel: string) => {
    const table = channel === 'whatsapp' ? 'whatsapp_messages' : 'email_conversations';
    await supabase
      .from(table)
      .update({ read_at: new Date().toISOString(), is_read: true })
      .eq('id', messageId);
  };

  const handleSendMessage = async () => {
    if (!activeConversation || !replyText.trim() || !effectiveOrgId) return;

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (activeConversation.channel === 'whatsapp') {
        // Send via WhatsApp edge function
        const { error } = await supabase.functions.invoke('send-whatsapp-message', {
          body: {
            contactId: activeConversation.contact_id,
            message: replyText,
            phoneNumber: activeConversation.phone_number,
          },
        });

        if (error) throw error;
      } else if (activeConversation.channel === 'email') {
        // Send via email (would need implementation)
        notify.info("Coming soon", "Email replies will be available soon");
        return;
      }

      setReplyText("");
      notify.success("Message sent", "Your message has been sent successfully");
      
      fetchMessages(activeConversation.conversation_id, activeConversation.channel);
    } catch (error: any) {
      notify.error("Error sending message", error);
    } finally {
      setSending(false);
    }
  };

  const getUnreadCount = (channel?: string) => {
    return conversations.filter((c) => 
      !c.is_read && 
      c.direction === 'inbound' &&
      (!channel || c.channel === channel)
    ).length;
  };

  // Email Campaigns queries
  const fetchCampaigns = async () => {
    const { data: campaignsData, error } = await supabase
      .from("email_bulk_campaigns")
      .select("*")
      .eq("org_id", effectiveOrgId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    
    // Fetch sender names for campaigns
    const createdByIds = [...new Set(campaignsData?.map(c => c.created_by).filter(Boolean))];
    let profilesMap: Record<string, { first_name: string | null; last_name: string | null }> = {};
    
    if (createdByIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", createdByIds);
      
      profilesMap = (profiles || []).reduce((acc, p) => {
        acc[p.id] = { first_name: p.first_name, last_name: p.last_name };
        return acc;
      }, {} as Record<string, { first_name: string | null; last_name: string | null }>);
    }
    
    return (campaignsData || []).map(c => ({
      ...c,
      sender_name: c.created_by && profilesMap[c.created_by] 
        ? [profilesMap[c.created_by].first_name, profilesMap[c.created_by].last_name].filter(Boolean).join(' ') 
        : null
    }));
  };

  const { data: campaigns = [], isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery({
    queryKey: ['email-campaigns', effectiveOrgId],
    queryFn: fetchCampaigns,
    enabled: !!effectiveOrgId,
  });

  useRealtimeSync({
    table: 'email_bulk_campaigns',
    filter: `org_id=eq.${effectiveOrgId}`,
    onUpdate: refetchCampaigns,
    onInsert: refetchCampaigns,
    enabled: !!effectiveOrgId,
  });

  const handleExportCampaigns = () => {
    try {
      const columns: ExportColumn[] = [
        { key: 'name', label: 'Campaign Name' },
        { key: 'subject', label: 'Subject' },
        { key: 'status', label: 'Status' },
        { key: 'total_recipients', label: 'Total Recipients' },
        { key: 'sent_count', label: 'Sent' },
        { key: 'failed_count', label: 'Failed' },
        { key: 'pending_count', label: 'Pending' },
        { key: 'created_at', label: 'Created', format: formatDateForExport },
      ];

      exportToCSV(campaigns, columns, `email-campaigns-${new Date().toISOString().split('T')[0]}`);
      
      notify.success("Success", "Campaigns exported successfully");
    } catch (error) {
      notify.error("Error", "Failed to export campaigns");
    }
  };


  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      draft: "secondary",
      sending: "default",
      completed: "default",
      failed: "destructive",
    };
    return <Badge variant={variants[status] || "secondary"}>{status}</Badge>;
  };

  // Filter campaigns based on search
  const filteredEmailCampaigns = campaigns.filter(campaign => {
    if (!emailCampaignSearch) return true;
    const search = emailCampaignSearch.toLowerCase();
    return (
      campaign.name?.toLowerCase().includes(search) ||
      campaign.subject?.toLowerCase().includes(search) ||
      campaign.sender_name?.toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <DashboardLayout>
        <LoadingState message="Loading communications..." />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col -m-4 lg:-m-6">
        <div className="border-b border-border p-4">
          <h1 className="text-3xl font-bold mb-4">Communications</h1>

          <Tabs value={mainTab} onValueChange={setMainTab}>
            <TabsList>
              <TabsTrigger value="conversations">
                <Inbox className="h-4 w-4 mr-2" />
                Conversations
                {getUnreadCount() > 0 && (
                  <Badge variant="destructive" className="ml-2">{getUnreadCount()}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="campaigns">
                <Mail className="h-4 w-4 mr-2" />
                Email Campaigns
              </TabsTrigger>
              <TabsTrigger value="whatsapp-campaigns">
                <MessageSquare className="h-4 w-4 mr-2" />
                WhatsApp Campaigns
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab} className="flex-1">
          <TabsContent value="conversations" className="h-full m-0">
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between mb-4">
                <Badge variant="secondary">
                  {getUnreadCount()} unread
                </Badge>
              </div>

              <Tabs value={channelFilter} onValueChange={setChannelFilter}>
                <TabsList>
                  <TabsTrigger value="all">
                    All {getUnreadCount() > 0 && `(${getUnreadCount()})`}
                  </TabsTrigger>
                  <TabsTrigger value="whatsapp">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    WhatsApp {getUnreadCount('whatsapp') > 0 && `(${getUnreadCount('whatsapp')})`}
                  </TabsTrigger>
                  <TabsTrigger value="email">
                    <Mail className="h-4 w-4 mr-2" />
                    Email {getUnreadCount('email') > 0 && `(${getUnreadCount('email')})`}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex-1 flex overflow-hidden">
          {/* Conversations List */}
          <Card className="w-96 border-r border-border rounded-none">
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <ScrollArea className="h-[calc(100vh-16rem)]">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No conversations found
                </div>
              ) : (
                filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleConversationClick(conv)}
                    className={`w-full p-4 border-b border-border hover:bg-muted/50 transition-colors text-left ${
                      activeConversation?.id === conv.id ? 'bg-muted' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-full ${
                        conv.channel === 'whatsapp' ? 'bg-green-500/10' : 'bg-blue-500/10'
                      }`}>
                        {conv.channel === 'whatsapp' ? (
                          <MessageSquare className="h-4 w-4 text-green-600" />
                        ) : (
                          <Mail className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className={`font-medium truncate ${!conv.is_read ? 'font-bold' : ''}`}>
                            {conv.contact_name || conv.sender_name || 'Unknown'}
                          </p>
                          {!conv.is_read && conv.direction === 'inbound' && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 ml-2" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.preview?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').substring(0, 100)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(conv.sent_at), 'MMM d, h:mm a')}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
          </Card>

          {/* Message Thread */}
          <div className="flex-1 flex flex-col">
            {activeConversation ? (
              <>
                {/* Contact Header */}
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold">
                        {activeConversation.contact_name || activeConversation.sender_name}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {activeConversation.channel === 'whatsapp' 
                          ? activeConversation.phone_number 
                          : activeConversation.email_address}
                      </p>
                    </div>
                  </div>
                  <Badge variant={activeConversation.channel === 'whatsapp' ? 'default' : 'secondary'}>
                    {activeConversation.channel === 'whatsapp' ? (
                      <><MessageSquare className="h-3 w-3 mr-1" /> WhatsApp</>
                    ) : (
                      <><Mail className="h-3 w-3 mr-1" /> Email</>
                    )}
                  </Badge>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {messages.map((msg) => {
                      const isEmail = !!msg.email_content;
                      const isOutbound = msg.direction === 'outbound';
                      
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                        >
                          {isEmail ? (
                            // Email: neutral container showing original email design
                            <div className="max-w-[85%] rounded-lg border border-border bg-background shadow-sm overflow-hidden">
                              <div className="px-4 py-2 border-b border-border bg-muted/50 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  {isOutbound ? 'Sent' : 'Received'} • {format(new Date(msg.sent_at), 'MMM d, h:mm a')}
                                </span>
                              </div>
                              {msg.subject && (
                                <div className="px-4 py-2 border-b border-border">
                                  <p className="font-semibold text-sm">{msg.subject}</p>
                                </div>
                              )}
                              <div 
                                className="p-4 prose prose-sm max-w-none dark:prose-invert [&_*]:!text-inherit"
                                dangerouslySetInnerHTML={{ __html: msg.email_content }}
                              />
                            </div>
                          ) : (
                            // WhatsApp: chat bubble style
                            <div
                              className={`max-w-[70%] rounded-lg p-3 ${
                                isOutbound
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted'
                              }`}
                            >
                              <p className="whitespace-pre-wrap">
                                {msg.message_content}
                              </p>
                              <p className="text-xs mt-2 opacity-70">
                                {format(new Date(msg.sent_at), 'MMM d, h:mm a')}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Reply Box */}
                <div className="p-4 border-t border-border">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Type your message..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="min-h-[60px]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!replyText.trim() || sending}
                      size="icon"
                      className="h-[60px]"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">Select a conversation</p>
                  <p className="text-sm">Choose a conversation to view messages</p>
                </div>
              </div>
            )}
          </div>
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="h-full m-0 p-6 overflow-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Email Campaigns</h2>
                  <p className="text-muted-foreground">
                    View and manage your email campaigns
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetchCampaigns()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportCampaigns} disabled={campaigns.length === 0}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button onClick={() => navigate("/bulk-email")}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Campaign
                  </Button>
                </div>
              </div>

              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, subject, or sender..."
                  value={emailCampaignSearch}
                  onChange={(e) => setEmailCampaignSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              {campaignsLoading ? (
                <LoadingState message="Loading email campaigns..." />
              ) : filteredEmailCampaigns.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Mail className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">{campaigns.length === 0 ? "No campaigns yet" : "No matching campaigns"}</h3>
                    <p className="text-muted-foreground text-center mb-4">
                      {campaigns.length === 0 ? "Create your first email campaign to get started" : "Try adjusting your search"}
                    </p>
                    {campaigns.length === 0 && (
                      <Button onClick={() => navigate("/bulk-email")}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Campaign
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign Name</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Sender</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Recipients</TableHead>
                          <TableHead>Sent</TableHead>
                          <TableHead>Failed</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEmailCampaigns.map((campaign) => (
                          <TableRow
                            key={campaign.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => navigate(`/email-campaigns/${campaign.id}`)}
                          >
                            <TableCell className="font-medium">{campaign.name}</TableCell>
                            <TableCell>{campaign.subject}</TableCell>
                            <TableCell>
                              {campaign.sender_name ? (
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8 bg-primary/10">
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                      {campaign.sender_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium">{campaign.sender_name}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                            <TableCell>{campaign.total_recipients}</TableCell>
                            <TableCell>{campaign.sent_count}</TableCell>
                            <TableCell>{campaign.failed_count}</TableCell>
                            <TableCell>
                              {format(new Date(campaign.created_at), "PP")}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/email-campaigns/${campaign.id}`);
                                }}
                              >
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="whatsapp-campaigns" className="h-full m-0 p-4">
            <div className="flex flex-col items-center justify-center py-16">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">WhatsApp Campaigns</h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                Bulk WhatsApp campaigns have moved to our dedicated WhatsApp platform for a better experience.
              </p>
              <Button onClick={() => window.open("https://wa.in-sync.co.in", "_blank")}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Open WhatsApp Campaign Manager
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
