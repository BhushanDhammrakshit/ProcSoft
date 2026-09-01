import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { useMutation } from '@tanstack/react-query';
import { AiSupplierSearchResult, searchSuppliersWithAi } from '../api/supplierSearch';

export function SupplierSearchPage() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiSupplierSearchResult | null>(null);

  const searchMutation = useMutation({
    mutationFn: searchSuppliersWithAi,
    onSuccess: (data) => setResult(data),
  });

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        AI Supplier Search
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="Describe what you need"
              fullWidth
              multiline
              minRows={2}
              placeholder="e.g. Need 2000 corrugated shipping boxes, double-wall, in Pune, budget around ₹1,50,000, delivery within 3 weeks"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              disabled={!prompt.trim() || searchMutation.isPending}
              onClick={() => searchMutation.mutate(prompt)}
              sx={{ whiteSpace: 'nowrap', mt: 1 }}
            >
              Search
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {searchMutation.isPending && (
        <Stack alignItems="center" sx={{ my: 4 }} spacing={1}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            Understanding requirement and searching suppliers...
          </Typography>
        </Stack>
      )}

      {searchMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Search failed. Please try again.
        </Alert>
      )}

      {result && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Extracted Requirement
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {result.criteria.product && <Chip label={`Product: ${result.criteria.product}`} />}
                {result.criteria.quantity && <Chip label={`Quantity: ${result.criteria.quantity}`} />}
                {result.criteria.location && <Chip label={`Location: ${result.criteria.location}`} />}
                {result.criteria.budget && <Chip label={`Budget: ${result.criteria.budget}`} />}
                {result.criteria.specifications && (
                  <Chip label={`Specs: ${result.criteria.specifications}`} />
                )}
              </Stack>
            </CardContent>
          </Card>

          {result.source === 'discovery' && (
            <Alert severity="info" icon={<TravelExploreIcon />} sx={{ mb: 2 }}>
              Not enough qualified suppliers were found in your database, so an automated discovery job ran
              against external sources.
              {result.job?.queries?.length ? (
                <Box sx={{ mt: 1 }}>
                  <strong>Search queries used:</strong> {result.job.queries.join(' · ')}
                </Box>
              ) : null}
              <Box sx={{ mt: 1 }}>
                Discovered {result.job?.discoveredCount ?? 0} candidates, {result.job?.qualifiedCount ?? 0}{' '}
                passed basic verification and were saved for review (status: pending verification).
              </Box>
            </Alert>
          )}

          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Ranked Suppliers
          </Typography>
          <Stack spacing={1}>
            {result.suppliers.length === 0 && (
              <Typography color="text.secondary">No matching suppliers found.</Typography>
            )}
            {result.suppliers.map((s) => (
              <Card key={s.supplierId} variant="outlined">
                <CardContent
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Box>
                    <Typography variant="body1">{s.legalName}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {s.reason}
                    </Typography>
                  </Box>
                  <Chip label={`Score: ${s.score}`} color="primary" />
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
