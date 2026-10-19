import { useState } from "react";
import DashboardLayout from "@/components/Layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Save, Download, Eye, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import DataSourceSelector from "@/components/Reports/DataSourceSelector";
import FieldSelector from "@/components/Reports/FieldSelector";
import ParameterPanel from "@/components/Reports/ParameterPanel";
import ReportCanvas, { ReportComponent } from "@/components/Reports/ReportCanvas";
import SaveReportDialog from "@/components/Reports/SaveReportDialog";
import { DataSourceType, getDataSource } from "@/config/reportDataSources";
import { ReportParameters } from "@/utils/reportQueryBuilder";
import { useOrgContext } from "@/hooks/useOrgContext";
import { useNotification } from "@/hooks/useNotification";
import { useGamingAccess } from "@/hooks/useGamingAccess";

export default function ReportBuilder() {
  const gaming = useGamingAccess();
  const { effectiveOrgId } = useOrgContext();
  const notify = useNotification();
  const navigate = useNavigate();
  
  const [selectedDataSource, setSelectedDataSource] = useState<DataSourceType | null>(null);
  const [parameters, setParameters] = useState<ReportParameters>({
    filters: [],
  });
  const [components, setComponents] = useState<ReportComponent[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const dataSource = selectedDataSource ? getDataSource(selectedDataSource) : null;

  const handleExportCSV = () => {
    notify.info("Export started", "Your report will be downloaded shortly");
    // CSV export logic would go here
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Report Builder</h1>
            <p className="text-muted-foreground">Create custom reports with drag-and-drop</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/reports/saved')}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Reports
            </Button>
            {gaming.canExport && (
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
            <Button onClick={() => setShowSaveDialog(true)} disabled={!selectedDataSource || components.length === 0}>
              <Save className="h-4 w-4 mr-2" />
              Save Report
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Data Source & Fields */}
          <div className="col-span-3 space-y-6">
            <Card className="p-4">
              <DataSourceSelector
                selected={selectedDataSource}
                onSelect={setSelectedDataSource}
              />
            </Card>

            {dataSource && (
              <Card className="p-4">
                <FieldSelector dataSource={dataSource} />
              </Card>
            )}
          </div>

          {/* Center - Canvas */}
          <div className="col-span-6">
            <Card className="p-6">
              {!selectedDataSource ? (
                <div className="h-[600px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">Select a Data Source</p>
                    <p className="text-sm">Choose a data source from the left to start building your report</p>
                  </div>
                </div>
              ) : (
                <ReportCanvas
                  components={components}
                  onChange={setComponents}
                  dataSource={selectedDataSource}
                  parameters={parameters}
                  orgId={effectiveOrgId!}
                />
              )}
            </Card>
          </div>

          {/* Right Sidebar - Parameters */}
          <div className="col-span-3">
            {dataSource && (
              <Card className="p-4">
                <ParameterPanel
                  dataSource={dataSource}
                  parameters={parameters}
                  onChange={setParameters}
                />
              </Card>
            )}
          </div>
        </div>
      </div>

      {selectedDataSource && (
        <SaveReportDialog
          open={showSaveDialog}
          onOpenChange={setShowSaveDialog}
          reportData={{
            dataSource: selectedDataSource,
            configuration: {
              parameters,
              components,
            },
          }}
          orgId={effectiveOrgId!}
          onSaved={() => {
            notify.success("Success", "Report saved successfully");
          }}
        />
      )}
    </DashboardLayout>
  );
}
