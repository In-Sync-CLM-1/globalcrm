import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  Mail, Clock, UserX, TrendingUp, Eye, Trophy, 
  Star, Search, Sparkles 
} from "lucide-react";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useUrlState } from "@/hooks/useUrlState";

const CATEGORY_ICONS = {
  onboarding: Mail,
  engagement: Eye,
  retention: UserX,
  conversion: Trophy,
};

const ICON_MAP: Record<string, any> = {
  Mail, Clock, UserX, TrendingUp, Eye, Trophy
};

interface RuleTemplatesGalleryProps {
  onSelectTemplate: (template: any) => void;
}

export function RuleTemplatesGallery({ onSelectTemplate }: RuleTemplatesGalleryProps) {
  const { effectiveOrgId } = useOrgContext();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useUrlState("tq", "");
  const [selectedCategory, setSelectedCategory] = useUrlState("tcat", "all");

  const { data: templates, isLoading } = useQuery({
    queryKey: ['email-automation-rule-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_automation_rule_templates')
        .select('*')
        .order('is_popular', { ascending: false })
        .order('use_count', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const useTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      // First get current use_count
      const { data: template } = await supabase
        .from('email_automation_rule_templates')
        .select('use_count')
        .eq('id', templateId)
        .single();
      
      if (template) {
        const { error } = await supabase
          .from('email_automation_rule_templates')
          .update({ use_count: template.use_count + 1 })
          .eq('id', templateId);
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-automation-rule-templates'] });
    },
  });

  const handleSelectTemplate = (template: any) => {
    useTemplateMutation.mutate(template.id);
    onSelectTemplate(template);
    toast.success(`Applied template: ${template.name}`);
  };

  const filteredTemplates = templates?.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const popularTemplates = templates?.filter(t => t.is_popular);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList>
          <TabsTrigger value="all">
            All Templates
          </TabsTrigger>
          <TabsTrigger value="onboarding">
            <Mail className="mr-2 h-4 w-4" />
            Onboarding
          </TabsTrigger>
          <TabsTrigger value="engagement">
            <Eye className="mr-2 h-4 w-4" />
            Engagement
          </TabsTrigger>
          <TabsTrigger value="retention">
            <UserX className="mr-2 h-4 w-4" />
            Retention
          </TabsTrigger>
          <TabsTrigger value="conversion">
            <Trophy className="mr-2 h-4 w-4" />
            Conversion
          </TabsTrigger>
        </TabsList>

        <TabsContent value={selectedCategory} className="space-y-6 mt-6">
          {selectedCategory === 'all' && popularTemplates && popularTemplates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Popular Templates</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {popularTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={handleSelectTemplate}
                  />
                ))}
              </div>
            </div>
          )}

          {filteredTemplates && filteredTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSelect={handleSelectTemplate}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No templates found</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface TemplateCardProps {
  template: any;
  onSelect: (template: any) => void;
}

function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const IconComponent = ICON_MAP[template.icon] || Mail;
  const CategoryIcon = CATEGORY_ICONS[template.category as keyof typeof CATEGORY_ICONS] || Mail;

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <IconComponent className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{template.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  <CategoryIcon className="mr-1 h-3 w-3" />
                  {template.category}
                </Badge>
                {template.is_popular && (
                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                )}
              </div>
            </div>
          </div>
        </div>
        <CardDescription className="mt-2 line-clamp-2">
          {template.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Used {template.use_count} times
          </span>
          <Button 
            size="sm" 
            onClick={() => onSelect(template)}
            className="group-hover:shadow-md transition-shadow"
          >
            Use Template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
