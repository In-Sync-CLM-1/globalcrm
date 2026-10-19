import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import FilterRow from "@/components/Pipeline/FilterRow";
import SearchResultsTable from "@/components/Pipeline/SearchResultsTable";
import { Plus, Search, X } from "lucide-react";
import { usePagination } from "@/hooks/usePagination";
import { exportToCSV, ExportColumn, formatDateForExport } from "@/utils/exportUtils";
import { useGamingAccess } from "@/hooks/useGamingAccess";

export interface SearchableField {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'email' | 'phone' | 'boolean';
  isCustomField: boolean;
  options?: string[];
  category: 'basic' | 'contact_info' | 'business' | 'location' | 'pipeline' | 'custom';
}

export interface Filter {
  id: string;
  fieldId: string;
  operator: string;
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

const PipelineAdvancedSearch = () => {
  const navigate = useNavigate();
  const { effectiveOrgId } = useOrgContext();
  const { success: showSuccess, error: showError } = useNotification();
  const [fields, setFields] = useState<SearchableField[]>([]);
  const [filters, setFilters] = useState<Filter[]>([{ id: '1', fieldId: '', operator: '', value: '' }]);
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const gaming = useGamingAccess();
  const isInitialMount = useRef(true);
  
  const pagination = usePagination({ defaultPageSize: 25 });

  // Fetch pipeline stages
  const { data: pipelineStages } = useQuery({
    queryKey: ['pipeline-stages', effectiveOrgId],
    queryFn: async () => {
      if (!effectiveOrgId) return [];
      const { data, error } = await supabase
        .from('pipeline_stages')
        .select('id, name')
        .eq('org_id', effectiveOrgId)
        .order('stage_order');
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveOrgId,
  });

  // Create a mapping of stage names to IDs for filtering
  const stageNameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    (pipelineStages || []).forEach(stage => {
      map.set(stage.name, stage.id);
    });
    return map;
  }, [pipelineStages]);

  // Load available fields
  useEffect(() => {
    const loadFields = async () => {
      if (!effectiveOrgId) return;

      setIsLoading(true);
      try {
        // Standard contact fields
        const standardFields: SearchableField[] = [
          { id: 'first_name', name: 'first_name', label: 'First Name', type: 'text', isCustomField: false, category: 'basic' },
          { id: 'last_name', name: 'last_name', label: 'Last Name', type: 'text', isCustomField: false, category: 'basic' },
          { id: 'email', name: 'email', label: 'Email', type: 'email', isCustomField: false, category: 'contact_info' },
          { id: 'phone', name: 'phone', label: 'Phone', type: 'phone', isCustomField: false, category: 'contact_info' },
          { id: 'company', name: 'company', label: 'Company', type: 'text', isCustomField: false, category: 'business' },
          { id: 'job_title', name: 'job_title', label: 'Job Title', type: 'text', isCustomField: false, category: 'business' },
          { 
            id: 'pipeline_stage_id', 
            name: 'pipeline_stage_id', 
            label: 'Pipeline Stage', 
            type: 'select', 
            isCustomField: false, 
            category: 'pipeline',
            options: (pipelineStages || []).map(stage => stage.name)
          },
          { id: 'source', name: 'source', label: 'Source', type: 'text', isCustomField: false, category: 'basic' },
          { id: 'status', name: 'status', label: 'Status', type: 'text', isCustomField: false, category: 'basic' },
          { id: 'city', name: 'city', label: 'City', type: 'text', isCustomField: false, category: 'location' },
          { id: 'state', name: 'state', label: 'State', type: 'text', isCustomField: false, category: 'location' },
          { id: 'country', name: 'country', label: 'Country', type: 'text', isCustomField: false, category: 'location' },
          { id: 'postal_code', name: 'postal_code', label: 'Postal Code', type: 'text', isCustomField: false, category: 'location' },
          { id: 'created_at', name: 'created_at', label: 'Created Date', type: 'date', isCustomField: false, category: 'basic' },
        ];

        // Load custom fields
        const { data: customFields } = await supabase
          .from('custom_fields')
          .select('*')
          .eq('org_id', effectiveOrgId)
          .eq('is_active', true)
          .order('field_order');

        const customFieldsMapped: SearchableField[] = (customFields || []).map(cf => ({
          id: cf.id,
          name: cf.field_name,
          label: cf.field_label,
          type: cf.field_type === 'textarea' ? 'text' : cf.field_type as any,
          isCustomField: true,
          options: cf.field_options as string[] || undefined,
          category: 'custom',
        }));

        setFields([...standardFields, ...customFieldsMapped]);
      } catch (error) {
        console.error('Error loading fields:', error);
        showError("Failed to load search fields");
      } finally {
        setIsLoading(false);
      }
    };

    loadFields();
  }, [effectiveOrgId, pipelineStages]);

  const addFilter = () => {
    setFilters([...filters, { id: Date.now().toString(), fieldId: '', operator: '', value: '' }]);
  };

  const removeFilter = (id: string) => {
    if (filters.length > 1) {
      setFilters(filters.filter(f => f.id !== id));
    }
  };

  const updateFilter = (id: string, updates: Partial<Filter>) => {
    setFilters(filters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const clearAllFilters = () => {
    setFilters([{ id: '1', fieldId: '', operator: '', value: '' }]);
    setResults([]);
  };

  const executeSearch = async () => {
    if (!effectiveOrgId) {
      showError('Organization context not found');
      return;
    }

    // Validate filters
    const validFilters = filters.filter(f => f.fieldId && f.operator && (
      f.operator === 'is_empty' || f.operator === 'is_not_empty' || f.value
    ));

    if (validFilters.length === 0) {
      showError('Please add at least one filter');
      return;
    }

    pagination.reset(); // Reset to page 1 on new search
    setHasSearched(true);
    performSearch();
  };

  const performSearch = async () => {
    if (!effectiveOrgId) return;

    const validFilters = filters.filter(f => f.fieldId && f.operator && (
      f.operator === 'is_empty' || f.operator === 'is_not_empty' || f.value
    ));
    
    setIsSearching(true);
    try {
      const offset = (pagination.currentPage - 1) * pagination.pageSize;
      
      // Build query for standard fields
      let query: any = supabase
        .from('contacts')
        .select(`
          *,
          pipeline_stages (
            name,
            color
          )
        `, { count: 'exact' })
        .eq('org_id', effectiveOrgId)
        .range(offset, offset + pagination.pageSize - 1);

      // Apply standard field filters to query
      for (const filter of validFilters) {
        const field = fields.find(f => f.id === filter.fieldId);
        if (!field || field.isCustomField) continue;

        // Special handling for pipeline_stage_id
        if (field.id === 'pipeline_stage_id') {
          const stageId = stageNameToIdMap.get(filter.value);
          if (stageId) {
            if (filter.operator === 'equals') {
              query = query.eq('pipeline_stage_id', stageId);
            } else if (filter.operator === 'not_equals') {
              query = query.neq('pipeline_stage_id', stageId);
            }
          }
          continue;
        }

        // Apply other filters
        switch (filter.operator) {
          case 'equals':
            query = query.eq(field.name, filter.value);
            break;
          case 'not_equals':
            query = query.neq(field.name, filter.value);
            break;
          case 'contains':
            query = query.ilike(field.name, `%${filter.value}%`);
            break;
          case 'not_contains':
            query = query.not(field.name, 'ilike', `%${filter.value}%`);
            break;
          case 'starts_with':
            query = query.ilike(field.name, `${filter.value}%`);
            break;
          case 'ends_with':
            query = query.ilike(field.name, `%${filter.value}`);
            break;
          case 'greater_than':
            query = query.gt(field.name, filter.value);
            break;
          case 'less_than':
            query = query.lt(field.name, filter.value);
            break;
          case 'is_empty':
            query = query.or(`${field.name}.is.null,${field.name}.eq.`);
            break;
          case 'is_not_empty':
            query = query.not(field.name, 'is', null).neq(field.name, '');
            break;
        }
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Search error:', error);
        throw error;
      }

      // Filter results by custom fields if needed
      let filteredResults = data || [];
      
      // Apply custom field filters
      const customFieldFilters = validFilters.filter(f => {
        const field = fields.find(field => field.id === f.fieldId);
        return field?.isCustomField;
      });

      if (customFieldFilters.length > 0) {
        const contactIds = filteredResults.map(c => c.id);
        if (contactIds.length > 0) {
          const { data: customFieldData } = await supabase
            .from('contact_custom_fields')
            .select('*')
            .in('contact_id', contactIds);

          filteredResults = filteredResults.filter(contact => {
            return customFieldFilters.every(filter => {
              const field = fields.find(f => f.id === filter.fieldId);
              if (!field) return true;

              const customValue = customFieldData?.find(
                cf => cf.contact_id === contact.id && cf.custom_field_id === field.id
              );

              if (!customValue) return false;

              const value = customValue.field_value;
              const filterValue = filter.value;

              switch (filter.operator) {
                case 'equals':
                  return value === filterValue;
                case 'not_equals':
                  return value !== filterValue;
                case 'contains':
                  return value?.toLowerCase().includes(filterValue.toLowerCase());
                case 'not_contains':
                  return !value?.toLowerCase().includes(filterValue.toLowerCase());
                case 'starts_with':
                  return value?.toLowerCase().startsWith(filterValue.toLowerCase());
                case 'ends_with':
                  return value?.toLowerCase().endsWith(filterValue.toLowerCase());
                case 'greater_than':
                  return Number(value) > Number(filterValue);
                case 'less_than':
                  return Number(value) < Number(filterValue);
                case 'is_empty':
                  return !value || value === '';
                case 'is_not_empty':
                  return value && value !== '';
                default:
                  return true;
              }
            });
          });
        }
      }

      setResults(filteredResults);
      pagination.setTotalRecords(count || 0);
      showSuccess(`Found ${count || 0} matching contacts`);
    } catch (error: any) {
      console.error('Search failed:', error);
      showError(error.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleExport = async () => {
    if (!effectiveOrgId || !hasSearched) {
      showError('Please perform a search first');
      return;
    }

    if (pagination.totalRecords === 0) {
      showError('No data to export');
      return;
    }

    setIsExporting(true);
    try {
      // Get valid filters
      const validFilters = filters.filter(f => f.fieldId && f.operator && (
        f.operator === 'is_empty' || f.operator === 'is_not_empty' || f.value
      ));

      // Build base query WITHOUT pagination to get ALL results
      const buildBaseQuery = () => {
        let q: any = supabase
          .from('contacts')
          .select(`
            *,
            pipeline_stages (
              name,
              color
            )
          `, { count: 'exact' })
          .eq('org_id', effectiveOrgId);

        // Apply all standard field filters
        for (const filter of validFilters) {
          const field = fields.find(f => f.id === filter.fieldId);
          if (!field || field.isCustomField) continue;

          // Special handling for pipeline_stage_id
          if (field.id === 'pipeline_stage_id') {
            const stageId = stageNameToIdMap.get(filter.value);
            if (stageId) {
              if (filter.operator === 'equals') {
                q = q.eq('pipeline_stage_id', stageId);
              } else if (filter.operator === 'not_equals') {
                q = q.neq('pipeline_stage_id', stageId);
              }
            }
            continue;
          }

          // Apply other filters
          switch (filter.operator) {
            case 'equals':
              q = q.eq(field.name, filter.value);
              break;
            case 'not_equals':
              q = q.neq(field.name, filter.value);
              break;
            case 'contains':
              q = q.ilike(field.name, `%${filter.value}%`);
              break;
            case 'not_contains':
              q = q.not(field.name, 'ilike', `%${filter.value}%`);
              break;
            case 'starts_with':
              q = q.ilike(field.name, `${filter.value}%`);
              break;
            case 'ends_with':
              q = q.ilike(field.name, `%${filter.value}`);
              break;
            case 'greater_than':
              q = q.gt(field.name, filter.value);
              break;
            case 'less_than':
              q = q.lt(field.name, filter.value);
              break;
            case 'is_empty':
              q = q.or(`${field.name}.is.null,${field.name}.eq.`);
              break;
            case 'is_not_empty':
              q = q.not(field.name, 'is', null).neq(field.name, '');
              break;
          }
        }

        return q;
      };

      // Supabase has a max of 1000 rows per query, so fetch in batches
      const batchSize = 1000;
      let from = 0;
      let allContacts: any[] = [];

      // We use totalRecords from the last search as an upper bound
      const totalToFetch = pagination.totalRecords || batchSize;

      // Fetch in batches until we've retrieved everything or run out of data
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const to = from + batchSize - 1;
        const { data, error } = await buildBaseQuery().range(from, to);

        if (error) throw error;

        if (!data || data.length === 0) break;

        allContacts = allContacts.concat(data);

        if (data.length < batchSize || allContacts.length >= totalToFetch) {
          break;
        }

        from += batchSize;
      }

      let exportData = allContacts || [];

      // Apply custom field filters if any
      const customFieldFilters = validFilters.filter(f => {
        const field = fields.find(field => field.id === f.fieldId);
        return field?.isCustomField;
      });

      if (customFieldFilters.length > 0) {
        const contactIds = exportData.map(c => c.id);
        if (contactIds.length > 0) {
          const { data: customFieldData } = await supabase
            .from('contact_custom_fields')
            .select('*')
            .in('contact_id', contactIds);

          exportData = exportData.filter(contact => {
            return customFieldFilters.every(filter => {
              const field = fields.find(f => f.id === filter.fieldId);
              if (!field) return true;

              const customValue = customFieldData?.find(
                cf => cf.contact_id === contact.id && cf.custom_field_id === field.id
              );

              if (!customValue) return false;

              const value = customValue.field_value;
              const filterValue = filter.value;

              switch (filter.operator) {
                case 'equals':
                  return value === filterValue;
                case 'not_equals':
                  return value !== filterValue;
                case 'contains':
                  return value?.toLowerCase().includes(filterValue.toLowerCase());
                case 'not_contains':
                  return !value?.toLowerCase().includes(filterValue.toLowerCase());
                case 'starts_with':
                  return value?.toLowerCase().startsWith(filterValue.toLowerCase());
                case 'ends_with':
                  return value?.toLowerCase().endsWith(filterValue.toLowerCase());
                case 'greater_than':
                  return Number(value) > Number(filterValue);
                case 'less_than':
                  return Number(value) < Number(filterValue);
                case 'is_empty':
                  return !value || value === '';
                case 'is_not_empty':
                  return value && value !== '';
                default:
                  return true;
              }
            });
          });
        }
      }

      // Fetch ALL custom field values for export
      if (exportData.length > 0) {
        const contactIds = exportData.map(c => c.id);
        const { data: allCustomFieldData } = await supabase
          .from('contact_custom_fields')
          .select('*')
          .in('contact_id', contactIds);

        // Create a map of custom field values
        const customFieldMap = new Map();
        (allCustomFieldData || []).forEach(cf => {
          if (!customFieldMap.has(cf.contact_id)) {
            customFieldMap.set(cf.contact_id, {});
          }
          const field = fields.find(f => f.id === cf.custom_field_id);
          if (field) {
            customFieldMap.get(cf.contact_id)[field.label] = cf.field_value;
          }
        });

        // Merge custom field data into contacts
        exportData = exportData.map(contact => ({
          ...contact,
          customFields: customFieldMap.get(contact.id) || {}
        }));
      }

      // Define export columns
      const exportColumns: ExportColumn[] = [
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'company', label: 'Company' },
        { key: 'job_title', label: 'Job Title' },
        { 
          key: 'pipeline_stage', 
          label: 'Pipeline Stage',
          format: (_, row) => row.pipeline_stages?.name || 'Unassigned'
        },
        { key: 'source', label: 'Source' },
        { key: 'status', label: 'Status' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'country', label: 'Country' },
        { key: 'postal_code', label: 'Postal Code' },
        { 
          key: 'created_at', 
          label: 'Created Date',
          format: (value) => formatDateForExport(value)
        },
      ];

      // Add custom field columns
      const customFields = fields.filter(f => f.isCustomField);
      customFields.forEach(cf => {
        exportColumns.push({
          key: `customFields.${cf.label}`,
          label: cf.label,
          format: (_, row) => row.customFields?.[cf.label] || ''
        });
      });

      // Generate filename with current date
      const today = new Date().toISOString().split('T')[0];
      const filename = `contacts-search-results-${today}`;

      // Export to CSV
      exportToCSV(exportData, exportColumns, filename);
      
      showSuccess(`Exported ${exportData.length} contacts to CSV`);
    } catch (error: any) {
      console.error('Export failed:', error);
      showError(error.message || 'Failed to export contacts');
    } finally {
      setIsExporting(false);
    }
  };

  // Fetch when pagination changes (after initial search)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (hasSearched && effectiveOrgId) {
      performSearch();
    }
  }, [pagination.currentPage, pagination.pageSize]);

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Advanced Search</h1>
            <p className="text-muted-foreground mt-1">Build complex queries to find contacts</p>
          </div>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <X className="h-4 w-4 mr-2" />
            Close
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter Builder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-muted-foreground">Loading fields...</p>
            ) : (
              <>
                {filters.map((filter, index) => (
                  <div key={filter.id}>
                    <FilterRow
                      filter={filter}
                      fields={fields}
                      onUpdate={(updates) => updateFilter(filter.id, updates)}
                      onRemove={() => removeFilter(filter.id)}
                      canRemove={filters.length > 1}
                    />
                    {index < filters.length - 1 && (
                      <div className="flex items-center justify-center my-2">
                        <span className="text-sm font-medium text-muted-foreground bg-muted px-3 py-1 rounded">
                          AND
                        </span>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex items-center gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={addFilter}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Filter
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                    Clear All
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button onClick={executeSearch} disabled={isSearching} className="flex-1">
            <Search className="h-4 w-4 mr-2" />
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
        </div>

        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Search Results ({pagination.totalRecords} contacts)</CardTitle>
            </CardHeader>
            <CardContent>
              <SearchResultsTable 
                contacts={results}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                pageSize={pagination.pageSize}
                totalRecords={pagination.totalRecords}
                startRecord={pagination.startRecord}
                endRecord={pagination.endRecord}
                onPageChange={pagination.setPage}
                onPageSizeChange={pagination.setPageSize}
                isLoading={isSearching}
                onExport={gaming.canExport ? handleExport : undefined}
                isExporting={isExporting}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default PipelineAdvancedSearch;
