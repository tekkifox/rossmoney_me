package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Config struct {
	Addr                  string
	MongoURI              string
	MongoDatabase         string
	MongoCollection       string
	SeedIfCollectionEmpty bool
}

type CMSDocument struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Collection string             `bson:"collection" json:"collection"`
	Slug       string             `bson:"slug" json:"slug"`
	Data       map[string]any     `bson:"data" json:"data"`
	UpdatedAt  time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type SitePayload struct {
	Home       map[string]any   `json:"home"`
	Projects   []map[string]any `json:"projects"`
	Experience []map[string]any `json:"experience"`
	Contact    map[string]any   `json:"contact"`
	UpdatedAt  string           `json:"updatedAt"`
}

type Server struct {
	store *Store
	mux   *http.ServeMux
}

type Store struct {
	collection *mongo.Collection
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(cfg.MongoURI))
	if err != nil {
		log.Fatal(err)
	}

	if err := client.Ping(ctx, nil); err != nil {
		log.Fatal(err)
	}

	store := &Store{collection: client.Database(cfg.MongoDatabase).Collection(cfg.MongoCollection)}
	if err := store.ensureIndexes(ctx); err != nil {
		log.Fatal(err)
	}
	if cfg.SeedIfCollectionEmpty {
		if err := store.seedDefaults(ctx); err != nil {
			log.Fatal(err)
		}
	}

	server := &Server{store: store, mux: http.NewServeMux()}
	server.routes()

	log.Printf("cms api listening on %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, server.withCORS(server.mux)); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() Config {
	addr := envOr("PORT", "8082")
	if !strings.Contains(addr, ":") {
		addr = ":" + addr
	}

	return Config{
		Addr:                  addr,
		MongoURI:              envOr("MONGODB_URI", "mongodb://mongo:27017"),
		MongoDatabase:         envOr("MONGODB_DATABASE", "rossmoney_me"),
		MongoCollection:       envOr("MONGODB_COLLECTION", "cms_documents"),
		SeedIfCollectionEmpty: envOr("MONGODB_SEED_DEFAULTS", "true") != "false",
	}
}

func envOr(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.health)
	s.mux.HandleFunc("/api/cms/site", s.handleSite)
	s.mux.HandleFunc("/api/cms/collections/", s.handleCollection)
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleSite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
		return
	}

	payload, err := s.store.buildSitePayload(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleCollection(w http.ResponseWriter, r *http.Request) {
	collection, slug := parseCollectionRequest(r.URL.Path)
	if collection == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("missing collection"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		if slug == "" {
			docs, err := s.store.listDocuments(r.Context(), collection)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, docs)
			return
		}
		doc, err := s.store.getDocument(r.Context(), collection, slug)
		if err != nil {
			writeNotFoundOrError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPost, http.MethodPut:
		if slug == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("missing slug"))
			return
		}
		var data map[string]any
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		doc := CMSDocument{
			Collection: collection,
			Slug:       slug,
			Data:       data,
			UpdatedAt:  time.Now().UTC(),
		}
		if _, err := s.store.upsertDocument(r.Context(), doc); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodDelete:
		if slug == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("missing slug"))
			return
		}
		if err := s.store.deleteDocument(r.Context(), collection, slug); err != nil {
			writeNotFoundOrError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
	}
}

func parseCollectionRequest(path string) (string, string) {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/cms/collections/"), "/")
	if trimmed == "" {
		return "", ""
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], parts[1]
}

func (s *Store) ensureIndexes(ctx context.Context) error {
	_, err := s.collection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "collection", Value: 1}, {Key: "slug", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	return err
}

func (s *Store) seedDefaults(ctx context.Context) error {
	count, err := s.collection.CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seed := defaultDocuments()
	docs := make([]any, 0, len(seed))
	for _, doc := range seed {
		docs = append(docs, doc)
	}
	_, err = s.collection.InsertMany(ctx, docs)
	return err
}

func defaultDocuments() []CMSDocument {
	return []CMSDocument{
		{
			Collection: "pages",
			Slug:       "home",
			UpdatedAt:  time.Now().UTC(),
			Data: map[string]any{
				"eyebrow":         "Available for devops and developer roles",
				"title":           "Building dependable systems with operational discipline.",
				"lead":            "I design and ship resilient developer experiences, automation layers, and production-ready interfaces. This portfolio can now be edited in Decap CMS and persisted in MongoDB.",
				"primaryButton":   map[string]any{"label": "Start a conversation", "href": "#contact"},
				"secondaryButton": map[string]any{"label": "Inspect live architecture", "href": "#architecture"},
				"metrics": []map[string]any{
					{"value": "99.95%", "label": "availability target"},
					{"value": "24/7", "label": "operations mindset"},
					{"value": "DX", "label": "developer experience focus"},
				},
				"focus": map[string]any{
					"kicker": "Current focus",
					"title":  "Building personal infrastructure",
					"status": "Live",
					"items": []map[string]any{
						{"label": "Role", "value": "DevOps-focused developer working on personal projects"},
						{"label": "Specialty", "value": "Storage servers, media servers, and reliable self-hosted services"},
						{"label": "Current build", "value": "Custom connectors and tooling for homelab and service automation"},
						{"label": "Delivery model", "value": "Small iterations, practical ops, and systems I can run myself"},
					},
				},
			},
		},
		{
			Collection: "pages",
			Slug:       "contact",
			UpdatedAt:  time.Now().UTC(),
			Data: map[string]any{
				"eyebrow": "Contact",
				"title":   "Open to platform, DevOps, and development work.",
				"lead":    "I am available for contract and full-time work, and I enjoy collaborating with teams to improve delivery and reliability.",
				"links": []map[string]any{
					{"label": "dev@rossmoney.me", "href": "mailto:dev@rossmoney.me"},
					{"label": "github.com/tekkifox", "href": "https://github.com/tekkifox"},
					{"label": "linkedin.com/in/rossmoney", "href": "https://www.linkedin.com/in/rossmoney"},
				},
			},
		},
		{
			Collection: "projects",
			Slug:       "morphsites",
			UpdatedAt:  time.Now().UTC(),
			Data:       map[string]any{"title": "Morphsites", "role": "Backend developer across Laravel and legacy PHP", "summary": "Built and maintained new Laravel projects and older PHP/Statamic sites, while handling support tickets autonomously through Jira.", "tags": []string{"Laravel", "Statamic", "Jira support"}, "order": 1},
		},
		{
			Collection: "projects",
			Slug:       "rawnet",
			UpdatedAt:  time.Now().UTC(),
			Data:       map[string]any{"title": "Rawnet Ltd.", "role": "PHP Developer with DevOps responsibility", "summary": "Supported in-house developers and AWS infrastructure, built local Docker setup commands, handled WAF blocking, monitored uptime, and managed Ubuntu patching with Canonical Landscape.", "tags": []string{"AWS", "Docker", "Ubuntu"}, "order": 2},
		},
		{
			Collection: "projects",
			Slug:       "project-better-energy",
			UpdatedAt:  time.Now().UTC(),
			Data:       map[string]any{"title": "Project Better Energy", "role": "Full stack PHP and Vue work for business tooling", "summary": "Worked in a small team maintaining Laravel applications, built Vue.js finance wizards, and delivered a stockist map feature for EV chargers.", "tags": []string{"Laravel", "Vue.js", "Tailwind / Bootstrap"}, "order": 3},
		},
		{
			Collection: "experience",
			Slug:       "devops",
			UpdatedAt:  time.Now().UTC(),
			Data:       map[string]any{"year": "2024 - Present", "title": "Personal infrastructure", "organization": "Homelab and service automation", "summary": "Building portfolio tooling, reverse-proxy deployments, and containerized services that I can operate end-to-end.", "highlights": []string{"Docker", "NGINX", "Go services"}, "order": 1},
		},
		{
			Collection: "experience",
			Slug:       "platform",
			UpdatedAt:  time.Now().UTC(),
			Data:       map[string]any{"year": "2021 - 2024", "title": "Platform support", "organization": "Managed hosting and application teams", "summary": "Kept production systems stable, handled support workloads, and improved developer delivery paths across PHP and AWS stacks.", "highlights": []string{"AWS", "Ubuntu", "Support"}, "order": 2},
		},
	}
}

func (s *Store) listDocuments(ctx context.Context, collection string) ([]map[string]any, error) {
	cur, err := s.collection.Find(ctx, bson.M{"collection": collection})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var docs []CMSDocument
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	sort.SliceStable(docs, func(i, j int) bool {
		li := sortOrder(docs[i].Data)
		lj := sortOrder(docs[j].Data)
		if li == lj {
			return docs[i].Slug < docs[j].Slug
		}
		return li < lj
	})

	result := make([]map[string]any, 0, len(docs))
	for _, doc := range docs {
		result = append(result, flattenDoc(doc))
	}
	return result, nil
}

func (s *Store) getDocument(ctx context.Context, collection, slug string) (map[string]any, error) {
	var doc CMSDocument
	err := s.collection.FindOne(ctx, bson.M{"collection": collection, "slug": slug}).Decode(&doc)
	if err != nil {
		return nil, err
	}
	return flattenDoc(doc), nil
}

func (s *Store) upsertDocument(ctx context.Context, doc CMSDocument) (CMSDocument, error) {
	if doc.UpdatedAt.IsZero() {
		doc.UpdatedAt = time.Now().UTC()
	}
	if doc.Data == nil {
		doc.Data = map[string]any{}
	}
	filter := bson.M{"collection": doc.Collection, "slug": doc.Slug}
	replacement := bson.M{"collection": doc.Collection, "slug": doc.Slug, "data": doc.Data, "updatedAt": doc.UpdatedAt}
	_, err := s.collection.ReplaceOne(ctx, filter, replacement, options.Replace().SetUpsert(true))
	return doc, err
}

func (s *Store) deleteDocument(ctx context.Context, collection, slug string) error {
	res, err := s.collection.DeleteOne(ctx, bson.M{"collection": collection, "slug": slug})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return mongo.ErrNoDocuments
	}
	return nil
}

func (s *Store) buildSitePayload(ctx context.Context) (SitePayload, error) {
	home, err := s.getDocument(ctx, "pages", "home")
	if err != nil {
		return SitePayload{}, err
	}
	contact, err := s.getDocument(ctx, "pages", "contact")
	if err != nil {
		return SitePayload{}, err
	}
	projects, err := s.listDocuments(ctx, "projects")
	if err != nil {
		return SitePayload{}, err
	}
	experience, err := s.listDocuments(ctx, "experience")
	if err != nil {
		return SitePayload{}, err
	}
	updated := time.Now().UTC().Format(time.RFC3339)
	return SitePayload{Home: home, Projects: projects, Experience: experience, Contact: contact, UpdatedAt: updated}, nil
}

func flattenDoc(doc CMSDocument) map[string]any {
	result := map[string]any{"slug": doc.Slug, "updatedAt": doc.UpdatedAt.Format(time.RFC3339)}
	for key, value := range doc.Data {
		result[key] = value
	}
	return result
}

func sortOrder(data map[string]any) int {
	if data == nil {
		return 0
	}
	if value, ok := data["order"]; ok {
		switch typed := value.(type) {
		case int:
			return typed
		case int32:
			return int(typed)
		case int64:
			return int(typed)
		case float64:
			return int(typed)
		case string:
			if parsed, err := strconv.Atoi(typed); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}

func writeNotFoundOrError(w http.ResponseWriter, err error) {
	if errors.Is(err, mongo.ErrNoDocuments) {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeError(w, http.StatusInternalServerError, err)
}
